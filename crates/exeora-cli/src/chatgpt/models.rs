use anyhow::{Context, Result, anyhow};
use serde::Deserialize;
use std::time::{Duration, Instant};

use super::{ChatgptService, MAX_API_BYTES, errors, session, store::StoredAccount};

const MODEL_CACHE_TTL: Duration = Duration::from_secs(10 * 60);
const MAX_MODELS: usize = 50;
const MAX_MODEL_ID_UTF16: usize = 128;
const MAX_MODEL_LABEL_UTF16: usize = 256;
const MODEL_REQUEST_TIMEOUT: Duration = Duration::from_secs(60);

#[derive(Debug, Clone, serde::Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Model {
    pub id: String,
    pub label: String,
}

#[derive(Debug, Deserialize)]
struct Catalog {
    models: Vec<RawModel>,
}

#[derive(Debug, Deserialize)]
struct RawModel {
    slug: String,
    #[serde(default)]
    display_name: Option<String>,
    #[serde(default)]
    visibility: Option<String>,
}

#[cfg(test)]
pub(crate) async fn list(service: &ChatgptService) -> Result<Vec<Model>> {
    list_for_revision(service, &session::revision(&service.store)?).await
}

pub(crate) async fn list_for_revision(
    service: &ChatgptService,
    expected: &session::Revision,
) -> Result<Vec<Model>> {
    let account = match service.access_account_for_revision(expected).await {
        Ok(account) => account,
        Err(error) => {
            session::ensure_current(&service.store, expected)?;
            // A still-valid local credential can remain in the ready state
            // when a proactive refresh fails because the network or the
            // provider is temporarily unavailable. Preserve that distinction
            // for callers instead of letting it look like signed-out state.
            if service
                .store
                .active_state()
                .is_ok_and(|state| state == "ready")
            {
                return Err(anyhow::Error::new(errors::ProviderError::from_fields(
                    "temporarily_unavailable",
                    Some("refresh_unavailable"),
                    None,
                    None,
                    None,
                )));
            }
            return Err(error);
        }
    };
    list_for(service, &account, expected).await
}

/// Fetch the account-specific catalog. The returned order is the server order;
/// no API-key `data[]` catalog or curated fallback is merged into it.
pub(crate) async fn list_for(
    service: &ChatgptService,
    account: &StoredAccount,
    expected: &session::Revision,
) -> Result<Vec<Model>> {
    session::ensure_current(&service.store, expected)?;
    if let Some((cached_at, models)) = service
        .models_cache
        .lock()
        .await
        .get(&account.client_id)
        .cloned()
        && cached_at.elapsed() < MODEL_CACHE_TTL
    {
        return Ok(models);
    }

    let mut response = request(service, account, expected).await?;
    if response.status == reqwest::StatusCode::UNAUTHORIZED {
        let refreshed = match service.force_refresh(account).await {
            Ok(account) => account,
            Err(_) => {
                return Err(anyhow::Error::new(errors::ProviderError {
                    failure: errors::refresh_failure(
                        service,
                        &account.client_id,
                        response.request_id.as_deref(),
                    ),
                }));
            }
        };
        response = request(service, &refreshed, expected).await?;
    }
    let models = parse_response(response)?;
    service
        .models_cache
        .lock()
        .await
        .insert(account.client_id.clone(), (Instant::now(), models.clone()));
    Ok(models)
}

struct ModelResponse {
    status: reqwest::StatusCode,
    request_id: Option<String>,
    body: Vec<u8>,
}

async fn request(
    service: &ChatgptService,
    account: &StoredAccount,
    expected: &session::Revision,
) -> Result<ModelResponse> {
    session::ensure_current(&service.store, expected)?;
    let token = account
        .access_token
        .as_deref()
        .ok_or_else(|| anyhow!("ChatGPT sign-in is required."))?;
    let response = tokio::time::timeout(
        MODEL_REQUEST_TIMEOUT,
        service
            .http
            .get(service.endpoints.models.as_str())
            .bearer_auth(token)
            .header(reqwest::header::ACCEPT, "application/json")
            .send(),
    )
    .await
    .context("Timed out waiting for the OpenAI model catalog.")?
    .context("Could not reach the OpenAI model catalog.")?;
    let status = response.status();
    let request_id = super::request_id(&response);
    let body = match super::read_bounded(response, MAX_API_BYTES).await {
        Ok(body) => body,
        Err(_) => {
            return Err(anyhow::Error::new(errors::ProviderError::from_fields(
                "failed",
                Some("response_too_large"),
                None,
                Some(status),
                request_id.as_deref(),
            )));
        }
    };
    Ok(ModelResponse {
        status,
        request_id,
        body,
    })
}

fn parse_response(response: ModelResponse) -> Result<Vec<Model>> {
    if !response.status.is_success() {
        return Err(anyhow::Error::new(errors::ProviderError::from_http(
            response.status,
            response.request_id.as_deref(),
            &response.body,
        )));
    }

    let catalog: Catalog = serde_json::from_slice(&response.body).map_err(|_| {
        anyhow::Error::new(errors::ProviderError::from_fields(
            "failed",
            Some("invalid_model_catalog"),
            None,
            Some(response.status),
            response.request_id.as_deref(),
        ))
    })?;
    let mut models = Vec::with_capacity(catalog.models.len().min(MAX_MODELS));
    for raw in catalog.models {
        if raw.visibility.as_deref() != Some("list") || !valid_model_id(&raw.slug) {
            continue;
        }
        let label = raw
            .display_name
            .filter(|label| {
                !label.is_empty() && label.encode_utf16().count() <= MAX_MODEL_LABEL_UTF16
            })
            .unwrap_or_else(|| raw.slug.clone());
        models.push(Model {
            id: raw.slug,
            label,
        });
        if models.len() == MAX_MODELS {
            break;
        }
    }

    Ok(models)
}

pub(crate) fn find_model(models: &[Model], requested: Option<&str>) -> Option<String> {
    match requested.filter(|value| !value.is_empty()) {
        Some(requested) if models.iter().any(|model| model.id == requested) => {
            Some(requested.to_owned())
        }
        Some(_) => None,
        None => models.first().map(|model| model.id.clone()),
    }
}

fn valid_model_id(value: &str) -> bool {
    let mut characters = value.chars();
    let Some(first) = characters.next() else {
        return false;
    };
    value.encode_utf16().count() <= MAX_MODEL_ID_UTF16
        && first.is_ascii_alphanumeric()
        && characters.all(|character| {
            character.is_ascii_alphanumeric() || matches!(character, '.' | '_' | ':' | '/' | '-')
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn model(id: &str) -> Model {
        Model {
            id: id.to_owned(),
            label: id.to_owned(),
        }
    }

    #[test]
    fn requested_model_must_be_in_the_server_catalog() {
        let catalog = vec![model("first"), model("second")];
        assert_eq!(find_model(&catalog, None).as_deref(), Some("first"));
        assert_eq!(
            find_model(&catalog, Some("second")).as_deref(),
            Some("second")
        );
        assert!(find_model(&catalog, Some("unknown")).is_none());
        assert_eq!(find_model(&catalog, Some("")).as_deref(), Some("first"));
    }

    #[test]
    fn data_body_is_not_a_model_catalog() {
        let value: Result<Catalog, _> = serde_json::from_value(serde_json::json!({
            "data": [{"id": "old"}]
        }));
        assert!(value.is_err());
    }

    #[test]
    fn visibility_filter_preserves_order_and_caps_model_ids() {
        assert!(valid_model_id("gpt-6.1-sol"));
        assert!(valid_model_id("vendor/model:v1"));
        assert!(!valid_model_id(" model"));
        assert!(!valid_model_id("../model"));
        assert!(!valid_model_id(&"a".repeat(MAX_MODEL_ID_UTF16 + 1)));
    }

    #[test]
    fn failure_keeps_status_and_request_id_for_model_requests() {
        let failure = errors::ProviderError::from_http(
            reqwest::StatusCode::TOO_MANY_REQUESTS,
            Some("req_model"),
            br#"{"error":{"code":"subscription_sharing_usage_limit_exceeded","param":"model"}}"#,
        );
        assert_eq!(failure.failure.reason, "usage_limit");
        assert_eq!(failure.failure.http_status, Some(429));
        assert_eq!(failure.failure.request_id.as_deref(), Some("req_model"));
        assert_eq!(failure.failure.param.as_deref(), Some("model"));
    }
}
