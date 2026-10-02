use super::ChatgptService;
use reqwest::StatusCode;
use serde::Serialize;
use serde_json::{Map, Value};
use std::{error::Error, fmt};

const MAX_FIELD_UTF16: usize = 128;
const MAX_REQUEST_ID_UTF16: usize = 128;

/// A provider error that can safely cross the ChatGPT workspace boundary.
///
/// The provider's diagnostic text is deliberately not stored here. Responses
/// may echo prompt content in a `detail` or `message` field, while the client
/// only needs the stable code, parameter, status and request ID.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Failure {
    pub reason: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub code: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub param: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub http_status: Option<u16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub request_id: Option<String>,
}

impl Failure {
    pub(crate) fn new(
        reason: impl Into<String>,
        code: Option<&str>,
        param: Option<&str>,
        http_status: Option<StatusCode>,
        request_id: Option<&str>,
    ) -> Self {
        Self {
            reason: reason.into(),
            code: sanitize_code(code),
            param: sanitize_code(param),
            http_status: http_status.map(|status| status.as_u16()),
            request_id: sanitize_request_id(request_id),
        }
    }

    pub(crate) fn value(&self, kind: &str) -> Value {
        let mut object = Map::new();
        object.insert("kind".to_owned(), Value::String(kind.to_owned()));
        object.insert("outcome".to_owned(), Value::String("failed".to_owned()));
        if let Ok(Value::Object(fields)) = serde_json::to_value(self) {
            object.extend(fields);
        }
        Value::Object(object)
    }
}

pub(crate) fn refresh_failure(
    service: &ChatgptService,
    client_id: &str,
    request_id: Option<&str>,
) -> Failure {
    let state = service.store.state_for(client_id).unwrap_or("ready");
    match state {
        "plan_disabled" => Failure::new(
            "plan_disabled",
            Some("chatpass_v2_scope_not_authorized"),
            None,
            Some(StatusCode::UNAUTHORIZED),
            request_id,
        ),
        "client_invalid" => Failure::new(
            "reconnect",
            Some("invalid_client"),
            None,
            Some(StatusCode::UNAUTHORIZED),
            request_id,
        ),
        "reconnect" => Failure::new(
            "reconnect",
            Some("subscription_sharing_invalid_user"),
            None,
            Some(StatusCode::UNAUTHORIZED),
            request_id,
        ),
        "signed_out" => Failure::new(
            "signed_out",
            Some("signed_out"),
            None,
            Some(StatusCode::UNAUTHORIZED),
            request_id,
        ),
        // A network/5xx refresh failure leaves the saved registration ready.
        // Preserve that distinction so the gateway can retry later instead
        // of sending the user through another sign-in flow.
        _ => Failure::new(
            "temporarily_unavailable",
            Some("refresh_unavailable"),
            None,
            Some(StatusCode::UNAUTHORIZED),
            request_id,
        ),
    }
}

/// Error returned by model discovery and other provider calls before a value
/// can be produced. Callers may downcast an `anyhow::Error` to preserve the
/// structured fields in a workspace response.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ProviderError {
    pub failure: Failure,
}

impl ProviderError {
    pub(crate) fn from_http(status: StatusCode, request_id: Option<&str>, body: &[u8]) -> Self {
        let (code, param) = parse_error_fields(body);
        Self {
            failure: Failure::new(
                reason_for(status, code.as_deref()),
                code.as_deref(),
                param.as_deref(),
                Some(status),
                request_id,
            ),
        }
    }

    pub(crate) fn from_fields(
        reason: &str,
        code: Option<&str>,
        param: Option<&str>,
        status: Option<StatusCode>,
        request_id: Option<&str>,
    ) -> Self {
        Self {
            failure: Failure::new(reason, code, param, status, request_id),
        }
    }

    pub(crate) fn value(&self, kind: &str) -> Value {
        self.failure.value(kind)
    }
}

impl fmt::Display for ProviderError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(formatter, "OpenAI request failed: {}", self.failure.reason)
    }
}

impl Error for ProviderError {}

/// Map documented direct-route and Responses API codes to the protocol's
/// bounded recovery vocabulary.
pub(crate) fn reason_for(status: StatusCode, code: Option<&str>) -> &'static str {
    match code {
        Some("subscription_sharing_usage_limit_exceeded") => "usage_limit",
        Some("subscription_sharing_user_not_eligible") => "not_eligible",
        Some("subscription_sharing_unsupported_capability") => "unsupported",
        Some("subscription_sharing_route_not_supported") => "route_not_supported",
        Some("subscription_sharing_invalid_user") => "reconnect",
        Some("chatpass_v2_scope_not_authorized")
        | Some("chatpass_v2_invalid_authorization_context") => "permission",
        Some("subscription_sharing_usage_unavailable")
        | Some("subscription_sharing_user_unavailable") => "temporarily_unavailable",
        Some("response_incomplete") => "incomplete",
        Some("stream_eof") | Some("stream_timeout") => "interrupted",
        Some("model_unavailable") => "model_unavailable",
        _ if status == StatusCode::UNAUTHORIZED => "reconnect",
        _ if status == StatusCode::FORBIDDEN => "region_or_policy",
        _ if status == StatusCode::TOO_MANY_REQUESTS => "usage_limit",
        _ if status.is_server_error() => "temporarily_unavailable",
        _ => "failed",
    }
}

pub(crate) fn parse_error_fields(body: &[u8]) -> (Option<String>, Option<String>) {
    #[derive(serde::Deserialize)]
    struct Envelope {
        error: Option<Fields>,
    }
    #[derive(serde::Deserialize)]
    struct Fields {
        code: Option<String>,
        param: Option<String>,
    }

    let Ok(envelope) = serde_json::from_slice::<Envelope>(body) else {
        return (None, None);
    };
    let Some(fields) = envelope.error else {
        return (None, None);
    };
    (
        sanitize_code(fields.code.as_deref()),
        sanitize_code(fields.param.as_deref()),
    )
}

pub(crate) fn sanitize_code(value: Option<&str>) -> Option<String> {
    sanitize_field(value, MAX_FIELD_UTF16, true)
}

pub(crate) fn sanitize_request_id(value: Option<&str>) -> Option<String> {
    sanitize_field(value, MAX_REQUEST_ID_UTF16, false)
}

fn sanitize_field(
    value: Option<&str>,
    max_utf16: usize,
    reject_whitespace: bool,
) -> Option<String> {
    let value = value?.trim();
    if value.is_empty()
        || value.encode_utf16().count() > max_utf16
        || value.chars().any(|character| {
            character.is_control() || (reject_whitespace && character.is_whitespace())
        })
    {
        return None;
    }
    Some(value.to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn documented_codes_map_to_stable_recovery_reasons() {
        assert_eq!(
            reason_for(
                StatusCode::TOO_MANY_REQUESTS,
                Some("subscription_sharing_usage_limit_exceeded")
            ),
            "usage_limit"
        );
        assert_eq!(
            reason_for(
                StatusCode::FORBIDDEN,
                Some("subscription_sharing_route_not_supported")
            ),
            "route_not_supported"
        );
        assert_eq!(
            reason_for(
                StatusCode::UNAUTHORIZED,
                Some("subscription_sharing_invalid_user")
            ),
            "reconnect"
        );
        assert_eq!(
            reason_for(StatusCode::SERVICE_UNAVAILABLE, None),
            "temporarily_unavailable"
        );
    }

    #[test]
    fn malformed_or_unbounded_provider_fields_are_dropped() {
        let fields = parse_error_fields(
            br#"{"error":{"code":"subscription_sharing_usage_limit_exceeded","param":"model"},"detail":"prompt must never escape"}"#,
        );
        assert_eq!(
            fields.0.as_deref(),
            Some("subscription_sharing_usage_limit_exceeded")
        );
        assert_eq!(fields.1.as_deref(), Some("model"));
        assert!(sanitize_code(Some(&"x".repeat(129))).is_none());
        assert!(sanitize_code(Some("has whitespace")).is_none());
    }

    #[test]
    fn serialized_failure_never_includes_provider_detail() {
        let failure = ProviderError::from_http(
            StatusCode::FORBIDDEN,
            Some("req_123"),
            br#"{"detail":"secret prompt text","error":{"code":"subscription_sharing_user_not_eligible"}}"#,
        );
        assert_eq!(failure.failure.reason, "not_eligible");
        let value = failure.value("chatgpt_generation");
        assert_eq!(value["requestId"], "req_123");
        assert!(value.get("detail").is_none());
        assert!(
            value
                .to_string()
                .contains("subscription_sharing_user_not_eligible")
        );
        assert!(!value.to_string().contains("secret prompt text"));
    }
}
