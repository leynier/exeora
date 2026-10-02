use anyhow::{Result, anyhow};
use futures_util::StreamExt;
use reqwest::StatusCode;
use serde_json::{Value, json};
use std::time::Duration;

use super::{
    ChatgptService, MAX_API_BYTES, MAX_OUTPUT_CHARS, MAX_SSE_BYTES, errors, models, session,
};
use crate::chatgpt::store::StoredAccount;

const MAX_INSTRUCTIONS_UTF16: usize = 4_000;
const MAX_INPUT_UTF16: usize = 220_000;
const GENERATION_TIMEOUT: Duration = Duration::from_secs(60);

#[cfg(test)]
pub(crate) async fn generate(service: &ChatgptService, action: &Value) -> Result<Value> {
    generate_for_revision(service, action, &session::revision(&service.store)?).await
}

pub(crate) async fn generate_for_revision(
    service: &ChatgptService,
    action: &Value,
    expected: &session::Revision,
) -> Result<Value> {
    generate_with_budget(service, action, expected, GENERATION_TIMEOUT).await
}

async fn generate_with_budget(
    service: &ChatgptService,
    action: &Value,
    expected: &session::Revision,
    budget: Duration,
) -> Result<Value> {
    // Refresh, catalog discovery, retries and streaming share one deadline.
    // Dropping this future still lets detached refresh persist token rotation.
    match tokio::time::timeout(budget, generate_inner(service, action, expected)).await {
        Ok(result) => result,
        Err(_) => Ok(failure(
            "interrupted",
            Some("generation_timeout"),
            None,
            None,
            None,
        )),
    }
}

async fn generate_inner(
    service: &ChatgptService,
    action: &Value,
    expected: &session::Revision,
) -> Result<Value> {
    let Some(instructions) = action.get("instructions").and_then(Value::as_str) else {
        return Ok(failure(
            "failed",
            Some("invalid_arguments"),
            None,
            None,
            None,
        ));
    };
    if utf16_len(instructions) > MAX_INSTRUCTIONS_UTF16 {
        return Ok(failure(
            "failed",
            Some("invalid_arguments"),
            Some("instructions"),
            None,
            None,
        ));
    }
    let Some(input) = action.get("input").and_then(Value::as_str) else {
        return Ok(failure(
            "failed",
            Some("invalid_arguments"),
            None,
            None,
            None,
        ));
    };
    if utf16_len(input) > MAX_INPUT_UTF16 {
        return Ok(failure(
            "failed",
            Some("invalid_arguments"),
            Some("input"),
            None,
            None,
        ));
    }
    let requested_model = match action.get("model") {
        None => None,
        Some(value) => match value.as_str() {
            Some(model) if valid_model_id(model) => Some(model),
            _ => {
                return Ok(failure(
                    "failed",
                    Some("invalid_arguments"),
                    Some("model"),
                    None,
                    None,
                ));
            }
        },
    };

    let account = match service.access_account_for_revision(expected).await {
        Ok(account) => account,
        Err(_) => return Ok(access_failure(service).await),
    };
    if !account.plan_usage_allowed() || account.state() == "plan_disabled" {
        return Ok(failure(
            "plan_disabled",
            Some("chatpass_v2_scope_not_authorized"),
            None,
            None,
            None,
        ));
    }

    let catalog = match models::list_for(service, &account, expected).await {
        Ok(catalog) => catalog,
        Err(error) => return Ok(provider_error_value(&error)),
    };
    // Model discovery may have refreshed this registration after a 401. Read
    // the same client record again before sending Responses so the inference
    // request uses the rotated access token instead of the stale snapshot.
    let account = match service.store.load(&account.client_id) {
        Ok(account) => account,
        Err(_) => return Ok(failure("temporarily_unavailable", None, None, None, None)),
    };
    if account.state() != "ready" || !account.plan_usage_allowed() {
        return Ok(access_failure(service).await);
    }
    let Some(model) = models::find_model(&catalog, requested_model) else {
        return Ok(failure(
            "model_unavailable",
            Some("model_unavailable"),
            Some("model"),
            None,
            None,
        ));
    };

    // Keep this object intentionally small. The preview route rejects the
    // broader Responses API surface, and `store` must never be enabled for
    // ChatGPT plan usage.
    let body = json!({
        "model": model,
        "instructions": instructions,
        "input": [{
            "role": "user",
            "content": [{
                "type": "input_text",
                "text": input,
            }],
        }],
        "store": false,
        "stream": true,
    });

    let outcome = match send_once(service, &account, &body, expected).await {
        Ok(first) if first.status == StatusCode::UNAUTHORIZED => {
            let refreshed = match service.force_refresh(&account).await {
                Ok(account) => account,
                Err(_) => {
                    return Ok(errors::refresh_failure(
                        service,
                        &account.client_id,
                        first.request_id.as_deref(),
                    )
                    .value("chatgpt_generation"));
                }
            };
            if refreshed.state() == "plan_disabled" || !refreshed.plan_usage_allowed() {
                return Ok(failure(
                    "plan_disabled",
                    Some("chatpass_v2_scope_not_authorized"),
                    None,
                    Some(StatusCode::UNAUTHORIZED),
                    first.request_id.as_deref(),
                ));
            }
            match send_once(service, &refreshed, &body, expected).await {
                Ok(second) => second,
                Err(_) => {
                    return Ok(failure(
                        "temporarily_unavailable",
                        Some("request_unavailable"),
                        None,
                        None,
                        first.request_id.as_deref(),
                    ));
                }
            }
        }
        Ok(first) => first,
        Err(_) => {
            return Ok(failure("temporarily_unavailable", None, None, None, None));
        }
    };

    if !outcome.status.is_success() {
        let status = outcome.status;
        let request_id = outcome.request_id.clone();
        let body = match super::read_bounded(outcome.response, MAX_API_BYTES).await {
            Ok(body) => body,
            Err(_) => {
                return Ok(failure(
                    "failed",
                    Some("response_too_large"),
                    None,
                    Some(status),
                    request_id.as_deref(),
                ));
            }
        };
        return Ok(
            errors::ProviderError::from_http(status, request_id.as_deref(), &body)
                .value("chatgpt_generation"),
        );
    }

    let request_id = outcome.request_id.clone();
    match parse_stream(outcome.response, &model, request_id.as_deref()).await {
        Ok(value) => Ok(value),
        Err(_) => Ok(failure(
            "interrupted",
            Some("stream_error"),
            None,
            Some(StatusCode::OK),
            request_id.as_deref(),
        )),
    }
}

struct ResponseStart {
    status: StatusCode,
    response: reqwest::Response,
    request_id: Option<String>,
}

async fn send_once(
    service: &ChatgptService,
    account: &StoredAccount,
    body: &Value,
    expected: &session::Revision,
) -> Result<ResponseStart> {
    session::ensure_current(&service.store, expected)?;
    let token = account
        .access_token
        .as_deref()
        .ok_or_else(|| anyhow!("ChatGPT sign-in is required."))?;
    let response = service
        .http
        .post(service.endpoints.responses.as_str())
        .bearer_auth(token)
        .header(reqwest::header::CONTENT_TYPE, "application/json")
        .header(reqwest::header::ACCEPT, "text/event-stream")
        .json(body)
        .send()
        .await?;
    let status = response.status();
    let request_id = super::request_id(&response);
    Ok(ResponseStart {
        status,
        response,
        request_id,
    })
}

async fn parse_stream(
    response: reqwest::Response,
    model: &str,
    request_id: Option<&str>,
) -> Result<Value> {
    let mut stream = response.bytes_stream();
    let mut buffer = Vec::<u8>::new();
    let mut data = String::new();
    let mut output = String::new();
    let mut terminal = false;
    let mut total = 0usize;

    while let Some(chunk) = stream.next().await {
        let chunk = chunk?;
        total = total.saturating_add(chunk.len());
        if total > MAX_SSE_BYTES {
            return Ok(failure(
                "failed",
                Some("stream_too_large"),
                None,
                Some(StatusCode::OK),
                request_id,
            ));
        }
        buffer.extend_from_slice(&chunk);
        while let Some(newline) = buffer.iter().position(|byte| *byte == b'\n') {
            let line = buffer.drain(..=newline).collect::<Vec<_>>();
            let line = &line[..line.len().saturating_sub(1)];
            let line = line.strip_suffix(b"\r").unwrap_or(line);
            let is_blank = match consume_line(line, &mut data) {
                Ok(value) => value,
                Err(_) => {
                    return Ok(failure(
                        "failed",
                        Some("invalid_event"),
                        None,
                        Some(StatusCode::OK),
                        request_id,
                    ));
                }
            };
            if is_blank {
                if let Some(event) = finish_event(&data, &mut output, request_id) {
                    match event {
                        EventResult::Completed => terminal = true,
                        EventResult::Continue => {}
                        EventResult::Failure(failure) => {
                            return Ok(failure.value("chatgpt_generation"));
                        }
                    }
                }
                data.clear();
                if terminal {
                    break;
                }
            }
        }
        if terminal {
            break;
        }
    }

    // A few HTTP servers close immediately after the final event and omit the
    // optional blank line. Treat the buffered `data:` frame as dispatched at
    // EOF, but still require that frame to be `response.completed`.
    if !terminal && !buffer.is_empty() {
        let line = buffer.strip_suffix(b"\r").unwrap_or(&buffer);
        if consume_line(line, &mut data).is_err() {
            return Ok(failure(
                "failed",
                Some("invalid_event"),
                None,
                Some(StatusCode::OK),
                request_id,
            ));
        }
    }
    if !terminal
        && !data.is_empty()
        && let Some(event) = finish_event(&data, &mut output, request_id)
    {
        match event {
            EventResult::Completed => terminal = true,
            EventResult::Continue => {}
            EventResult::Failure(failure) => return Ok(failure.value("chatgpt_generation")),
        }
    }

    if !terminal {
        return Ok(failure(
            "interrupted",
            Some("stream_eof"),
            None,
            Some(StatusCode::OK),
            request_id,
        ));
    }
    Ok(json!({
        "kind": "chatgpt_generation",
        "outcome": "completed",
        "text": output,
        "model": model,
    }))
}

/// Return `true` for a blank SSE record delimiter. Unknown SSE metadata is
/// ignored, while malformed UTF-8 is treated as a provider stream failure.
fn consume_line(line: &[u8], data: &mut String) -> Result<bool> {
    if line.is_empty() {
        return Ok(true);
    }
    let line = std::str::from_utf8(line).map_err(|_| anyhow!("OpenAI returned invalid SSE."))?;
    if line.starts_with(':') || line.starts_with("event:") || line.starts_with("id:") {
        return Ok(false);
    }
    if let Some(value) = line.strip_prefix("data:") {
        let value = value.strip_prefix(' ').unwrap_or(value);
        if data
            .encode_utf16()
            .count()
            .saturating_add(value.encode_utf16().count())
            > MAX_SSE_BYTES
        {
            return Ok(false);
        }
        if !data.is_empty() {
            data.push('\n');
        }
        data.push_str(value);
    }
    Ok(false)
}

enum EventResult {
    Continue,
    Completed,
    Failure(errors::Failure),
}

fn finish_event(data: &str, output: &mut String, request_id: Option<&str>) -> Option<EventResult> {
    if data.is_empty() || data == "[DONE]" {
        return Some(EventResult::Continue);
    }
    let value: Value = match serde_json::from_str(data) {
        Ok(value) => value,
        Err(_) => {
            return Some(EventResult::Failure(errors::Failure::new(
                "failed",
                Some("invalid_event"),
                None,
                Some(StatusCode::OK),
                request_id,
            )));
        }
    };
    let kind = value
        .get("type")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let event_request_id = event_request_id(&value);
    let request_id = event_request_id.as_deref().or(request_id);
    match kind {
        "response.output_text.delta" => {
            let Some(delta) = value.get("delta").and_then(Value::as_str) else {
                return Some(EventResult::Failure(errors::Failure::new(
                    "failed",
                    Some("invalid_event"),
                    None,
                    Some(StatusCode::OK),
                    request_id,
                )));
            };
            if utf16_len(output).saturating_add(utf16_len(delta)) > MAX_OUTPUT_CHARS {
                return Some(EventResult::Failure(errors::Failure::new(
                    "failed",
                    Some("output_too_large"),
                    None,
                    Some(StatusCode::OK),
                    request_id,
                )));
            }
            output.push_str(delta);
            Some(EventResult::Continue)
        }
        "response.completed" => {
            if output.is_empty() {
                let response = value.get("response").unwrap_or(&Value::Null);
                let text = match canonical_output_text(response) {
                    Ok(text) => text,
                    Err(code) => {
                        return Some(EventResult::Failure(errors::Failure::new(
                            "failed",
                            Some(code),
                            None,
                            Some(StatusCode::OK),
                            request_id,
                        )));
                    }
                };
                output.push_str(&text);
            }
            Some(EventResult::Completed)
        }
        "response.failed" => {
            let (code, param) = value
                .get("response")
                .and_then(|response| response.get("error"))
                .map(error_fields)
                .unwrap_or((None, None));
            let code = code.or_else(|| Some("response_failed".to_owned()));
            Some(EventResult::Failure(errors::Failure::new(
                errors::reason_for(StatusCode::OK, code.as_deref()),
                code.as_deref(),
                param.as_deref(),
                Some(StatusCode::OK),
                request_id,
            )))
        }
        "response.incomplete" => Some(EventResult::Failure(errors::Failure::new(
            "incomplete",
            Some("response_incomplete"),
            None,
            Some(StatusCode::OK),
            request_id,
        ))),
        "error" => {
            // Responses SSE error frames use the wire shape `{type, code,
            // param, message}`. Keep a nested fallback for tolerant handling
            // of older fixtures, but prefer the canonical top-level fields.
            let mut fields = error_fields(&value);
            if fields.0.is_none() && fields.1.is_none() {
                fields = value.get("error").map(error_fields).unwrap_or((None, None));
            }
            let (code, param) = fields;
            Some(EventResult::Failure(errors::Failure::new(
                errors::reason_for(StatusCode::OK, code.as_deref()),
                code.as_deref(),
                param.as_deref(),
                Some(StatusCode::OK),
                request_id,
            )))
        }
        _ => Some(EventResult::Continue),
    }
}

fn canonical_output_text(response: &Value) -> Result<String, &'static str> {
    let Some(output) = response.get("output") else {
        return Ok(String::new());
    };
    let Some(items) = output.as_array() else {
        return Err("invalid_event");
    };
    let mut text = String::new();
    for item in items {
        let Some(content) = item.get("content") else {
            continue;
        };
        let Some(parts) = content.as_array() else {
            return Err("invalid_event");
        };
        for part in parts {
            if part.get("type").and_then(Value::as_str) != Some("output_text") {
                continue;
            }
            let Some(value) = part.get("text").and_then(Value::as_str) else {
                return Err("invalid_event");
            };
            if utf16_len(&text).saturating_add(utf16_len(value)) > MAX_OUTPUT_CHARS {
                return Err("output_too_large");
            }
            text.push_str(value);
        }
    }
    Ok(text)
}

fn error_fields(value: &Value) -> (Option<String>, Option<String>) {
    let code = value
        .get("code")
        .and_then(Value::as_str)
        .and_then(|value| errors::sanitize_code(Some(value)));
    let param = value
        .get("param")
        .and_then(Value::as_str)
        .and_then(|value| errors::sanitize_code(Some(value)));
    (code, param)
}

fn event_request_id(value: &Value) -> Option<String> {
    value
        .get("request_id")
        .or_else(|| value.get("requestId"))
        .or_else(|| {
            value
                .get("response")
                .and_then(|response| response.get("request_id"))
        })
        .or_else(|| {
            value
                .get("response")
                .and_then(|response| response.get("error"))
                .and_then(|error| error.get("request_id"))
        })
        .or_else(|| value.get("error").and_then(|error| error.get("request_id")))
        .and_then(Value::as_str)
        .and_then(|value| errors::sanitize_request_id(Some(value)))
}

fn provider_error_value(error: &anyhow::Error) -> Value {
    error
        .downcast_ref::<errors::ProviderError>()
        .map(|error| error.value("chatgpt_generation"))
        .unwrap_or_else(|| failure("temporarily_unavailable", None, None, None, None))
}

async fn access_failure(service: &ChatgptService) -> Value {
    let state = service.store.active_state().unwrap_or("signed_out");
    match state {
        "plan_disabled" => failure(
            "plan_disabled",
            Some("chatpass_v2_scope_not_authorized"),
            None,
            None,
            None,
        ),
        "client_invalid" => failure("reconnect", Some("invalid_client"), None, None, None),
        "reconnect" => failure(
            "reconnect",
            Some("subscription_sharing_invalid_user"),
            None,
            None,
            None,
        ),
        // `access_account` can fail while its stored token and granted scope
        // are still usable: refresh failures caused by a network/503 leave
        // the record ready. Do not turn that transient state into signed_out.
        "ready" => failure(
            "temporarily_unavailable",
            Some("refresh_unavailable"),
            None,
            None,
            None,
        ),
        _ => failure("signed_out", Some("signed_out"), None, None, None),
    }
}

fn failure(
    reason: &str,
    code: Option<&str>,
    param: Option<&str>,
    status: Option<StatusCode>,
    request_id: Option<&str>,
) -> Value {
    errors::Failure::new(reason, code, param, status, request_id).value("chatgpt_generation")
}

fn utf16_len(value: &str) -> usize {
    value.encode_utf16().count()
}

fn valid_model_id(value: &str) -> bool {
    let mut characters = value.chars();
    let Some(first) = characters.next() else {
        return false;
    };
    value.encode_utf16().count() <= 128
        && first.is_ascii_alphanumeric()
        && characters.all(|character| {
            character.is_ascii_alphanumeric() || matches!(character, '.' | '_' | ':' | '/' | '-')
        })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{collections::VecDeque, sync::Arc};
    use tempfile::{TempDir, tempdir};
    use tokio::{
        io::{AsyncReadExt, AsyncWriteExt},
        net::{TcpListener, TcpStream},
        sync::Mutex,
        task::JoinHandle,
    };

    #[derive(Debug, Clone)]
    struct MockResponse {
        path: Option<&'static str>,
        status: u16,
        content_type: &'static str,
        request_id: Option<&'static str>,
        body: Vec<u8>,
    }

    #[derive(Debug, Clone)]
    struct CapturedRequest {
        path: String,
        body: Vec<u8>,
        authorization: Option<String>,
    }

    async fn mock_server(
        responses: Vec<MockResponse>,
    ) -> (String, Arc<Mutex<Vec<CapturedRequest>>>, JoinHandle<()>) {
        let listener = TcpListener::bind(("127.0.0.1", 0)).await.unwrap();
        let address = listener.local_addr().unwrap();
        let responses = Arc::new(Mutex::new(VecDeque::from(responses)));
        let captured = Arc::new(Mutex::new(Vec::new()));
        let response_queue = Arc::clone(&responses);
        let captured_requests = Arc::clone(&captured);
        let task = tokio::spawn(async move {
            loop {
                let Ok((stream, _)) = listener.accept().await else {
                    break;
                };
                let response_queue = Arc::clone(&response_queue);
                let captured_requests = Arc::clone(&captured_requests);
                tokio::spawn(async move {
                    handle_request(stream, response_queue, captured_requests).await;
                });
            }
        });
        (format!("http://{address}/"), captured, task)
    }

    async fn handle_request(
        mut stream: TcpStream,
        responses: Arc<Mutex<VecDeque<MockResponse>>>,
        captured: Arc<Mutex<Vec<CapturedRequest>>>,
    ) {
        let mut request = Vec::new();
        let mut scratch = [0_u8; 4096];
        let header_end;
        loop {
            let Ok(read) = stream.read(&mut scratch).await else {
                return;
            };
            if read == 0 {
                return;
            }
            request.extend_from_slice(&scratch[..read]);
            if let Some(position) = request.windows(4).position(|window| window == b"\r\n\r\n") {
                header_end = position + 4;
                break;
            }
            if request.len() > 128 * 1024 {
                return;
            }
        }
        let header = String::from_utf8_lossy(&request[..header_end]).into_owned();
        let content_length = header
            .lines()
            .find_map(|line| {
                line.strip_prefix("Content-Length:")
                    .or_else(|| line.strip_prefix("content-length:"))
            })
            .and_then(|value| value.trim().parse::<usize>().ok())
            .unwrap_or(0);
        while request.len() < header_end.saturating_add(content_length) {
            let Ok(read) = stream.read(&mut scratch).await else {
                return;
            };
            if read == 0 {
                return;
            }
            request.extend_from_slice(&scratch[..read]);
            if request.len() > 10 * 1024 * 1024 {
                return;
            }
        }
        let request_line = header.lines().next().unwrap_or_default();
        let path = request_line
            .split_whitespace()
            .nth(1)
            .unwrap_or_default()
            .to_owned();
        let body = request[header_end..header_end + content_length].to_vec();
        let authorization = header
            .lines()
            .find_map(|line| {
                line.strip_prefix("Authorization:")
                    .or_else(|| line.strip_prefix("authorization:"))
            })
            .map(str::trim)
            .map(str::to_owned);
        captured.lock().await.push(CapturedRequest {
            path: path.clone(),
            body,
            authorization,
        });

        let request_path = path.clone();
        let response = {
            let mut queue = responses.lock().await;
            let selected = queue.iter().position(|response| {
                response
                    .path
                    .is_some_and(|expected_path| request_path.ends_with(expected_path))
            });
            selected
                .and_then(|index| queue.remove(index))
                .or_else(|| {
                    if request_path.ends_with("/models") {
                        Some(MockResponse {
                            path: None,
                            status: 200,
                            content_type: "application/json",
                            request_id: Some("req_models"),
                            body: br#"{"models":[{"slug":"gpt-6.1-sol","display_name":"Sol","visibility":"list"},{"slug":"hidden","display_name":"Hidden","visibility":"private"}]}"#.to_vec(),
                        })
                    } else {
                        queue.pop_front()
                    }
                })
                .unwrap_or(MockResponse {
                    path: None,
                status: 500,
                content_type: "application/json",
                request_id: Some("req_missing"),
                body: br#"{"error":{"code":"test_missing_response"}}"#.to_vec(),
                })
        };
        if response.status == 0 {
            // Test-only response: accept and capture the request, then close
            // the socket before sending headers to simulate a network error.
            return;
        }
        let reason = match response.status {
            200 => "OK",
            401 => "Unauthorized",
            403 => "Forbidden",
            429 => "Too Many Requests",
            503 => "Service Unavailable",
            _ => "Error",
        };
        let mut headers = format!(
            "HTTP/1.1 {} {}\r\nContent-Type: {}\r\nContent-Length: {}\r\nConnection: close\r\n",
            response.status,
            reason,
            response.content_type,
            response.body.len(),
        );
        if let Some(request_id) = response.request_id {
            headers.push_str(&format!("x-request-id: {request_id}\r\n"));
        }
        headers.push_str("\r\n");
        let _ = stream.write_all(headers.as_bytes()).await;
        let _ = stream.write_all(&response.body).await;
    }

    async fn test_service(base: &str) -> (TempDir, Arc<ChatgptService>) {
        let directory = tempdir().unwrap();
        let service = ChatgptService::new_test(&directory.path().join("config.json"), base);
        service
            .store
            .save(&StoredAccount {
                email: Some("user@example.com".to_owned()),
                issuer: "https://auth.openai.com".to_owned(),
                subject: "subject".to_owned(),
                client_id: "issued_client".to_owned(),
                ext_agent_host_id: "urn:uuid:test".to_owned(),
                id_token: None,
                access_token: Some("access".to_owned()),
                refresh_token: Some("refresh".to_owned()),
                token_type: "Bearer".to_owned(),
                expires_at: Some(u64::MAX),
                earliest_refresh_at: None,
                scopes: vec!["chatgpt.tokens.use.direct".to_owned()],
                saved_at: 0,
                label: Some("user@example.com".to_owned()),
                state: None,
                new_registration: false,
                welcome_notice_id: None,
            })
            .unwrap();
        (directory, service)
    }

    fn response(body: impl Into<Vec<u8>>) -> MockResponse {
        MockResponse {
            path: None,
            status: 200,
            content_type: "text/event-stream",
            request_id: Some("req_response"),
            body: body.into(),
        }
    }

    fn event(data: &str) -> EventResult {
        let mut output = String::new();
        finish_event(data, &mut output, Some("req_test")).expect("event result")
    }

    #[test]
    fn completed_stream_uses_delta_text_and_requires_terminal_event() {
        let mut output = String::new();
        assert!(matches!(
            finish_event(
                r#"{"type":"response.output_text.delta","delta":"Hello"}"#,
                &mut output,
                None,
            ),
            Some(EventResult::Continue)
        ));
        assert_eq!(output, "Hello");
        assert!(matches!(
            finish_event(r#"{"type":"response.completed"}"#, &mut output, None),
            Some(EventResult::Completed)
        ));
    }

    #[test]
    fn completed_event_reads_canonical_output_items_without_sdk_shortcut() {
        let mut output = String::new();
        let result = finish_event(
            r#"{"type":"response.completed","response":{"output":[{"type":"message","content":[{"type":"output_text","text":"Canonical answer"}]}]}}"#,
            &mut output,
            Some("req_wire"),
        );
        assert!(matches!(result, Some(EventResult::Completed)));
        assert_eq!(output, "Canonical answer");
    }

    #[test]
    fn error_event_reads_top_level_wire_code_and_param() {
        let result = event(
            r#"{"type":"error","code":"subscription_sharing_usage_limit_exceeded","param":"model","message":"redacted"}"#,
        );
        let EventResult::Failure(failure) = result else {
            panic!("expected failure");
        };
        assert_eq!(failure.reason, "usage_limit");
        assert_eq!(
            failure.code.as_deref(),
            Some("subscription_sharing_usage_limit_exceeded")
        );
        assert_eq!(failure.param.as_deref(), Some("model"));
    }

    #[test]
    fn failed_event_preserves_official_code_and_param() {
        let result = event(
            r#"{"type":"response.failed","response":{"error":{"code":"subscription_sharing_usage_limit_exceeded","param":"model","request_id":"req_terminal"}}}"#,
        );
        let EventResult::Failure(failure) = result else {
            panic!("expected failure");
        };
        assert_eq!(failure.reason, "usage_limit");
        assert_eq!(
            failure.code.as_deref(),
            Some("subscription_sharing_usage_limit_exceeded")
        );
        assert_eq!(failure.param.as_deref(), Some("model"));
        assert_eq!(failure.http_status, Some(200));
        assert_eq!(failure.request_id.as_deref(), Some("req_terminal"));
    }

    #[test]
    fn incomplete_and_eof_are_distinct() {
        let result = event(r#"{"type":"response.incomplete"}"#);
        let EventResult::Failure(incomplete) = result else {
            panic!("expected incomplete");
        };
        assert_eq!(incomplete.reason, "incomplete");
        assert_eq!(incomplete.code.as_deref(), Some("response_incomplete"));
        let eof = failure(
            "interrupted",
            Some("stream_eof"),
            None,
            Some(StatusCode::OK),
            None,
        );
        assert_eq!(eof["reason"], "interrupted");
    }

    #[test]
    fn output_cap_counts_utf16_units() {
        let mut output = "😀".repeat(MAX_OUTPUT_CHARS / 2);
        assert!(matches!(
            finish_event(
                r#"{"type":"response.output_text.delta","delta":"x"}"#,
                &mut output,
                None,
            ),
            Some(EventResult::Failure(_))
        ));
    }

    #[test]
    fn input_limits_match_protocol_utf16_limits() {
        assert!(utf16_len(&"😀".repeat(MAX_INPUT_UTF16 / 2)) <= MAX_INPUT_UTF16);
        assert!(utf16_len(&"😀".repeat(MAX_INSTRUCTIONS_UTF16 / 2 + 1)) > MAX_INSTRUCTIONS_UTF16);
    }

    #[test]
    fn sse_data_lines_join_and_ignore_done_sentinel() {
        let mut data = String::new();
        assert!(!consume_line(b"data: {\"type\":\"response.completed\"}", &mut data).unwrap());
        assert_eq!(data, r#"{"type":"response.completed"}"#);
        assert!(!consume_line(b"data: [DONE]", &mut data).unwrap());
    }

    #[tokio::test]
    async fn generation_deadline_includes_catalog_and_response_headers() {
        use axum::{
            Router,
            routing::{get, post},
        };
        use std::sync::atomic::{AtomicUsize, Ordering};
        let requests = Arc::new(AtomicUsize::new(0));
        let app = Router::new()
            .route("/v1/models", get({
                let requests = requests.clone();
                move || { let requests = requests.clone(); async move {
                    requests.fetch_add(1, Ordering::SeqCst);
                    tokio::time::sleep(Duration::from_millis(200)).await;
                    axum::Json(json!({"models":[{"slug":"test-model", "visibility":"list"}]}))
                }}
            }))
            .route("/v1/responses", post({
                let requests = requests.clone();
                move || { let requests = requests.clone(); async move {
                    requests.fetch_add(1, Ordering::SeqCst);
                    tokio::time::sleep(Duration::from_millis(400)).await;
                    ([(reqwest::header::CONTENT_TYPE,"text/event-stream")],
                        "data: {\"type\":\"response.completed\",\"response\":{\"output\":[{\"type\":\"message\",\"content\":[{\"type\":\"output_text\",\"text\":\"Too late\"}]}]}}\n\n")
                }}
            }));
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        let server = tokio::spawn(async move {
            let _ = axum::serve(listener, app).await;
        });
        let (_directory, service) = test_service(&base).await;
        let result = tokio::time::timeout(
            Duration::from_secs(2),
            generate_with_budget(
                &service,
                &json!({"instructions":"Commit", "input":"diff"}),
                &session::revision(&service.store).unwrap(),
                Duration::from_millis(500),
            ),
        )
        .await
        .unwrap()
        .unwrap();
        assert_eq!(requests.load(Ordering::SeqCst), 2);
        assert_eq!(result["reason"], "interrupted");
        assert_eq!(result["code"], "generation_timeout");
        assert!(result.get("text").is_none());
        server.abort();
    }

    #[tokio::test]
    async fn generation_timeout_preserves_detached_refresh_without_sending_the_prompt() {
        use axum::{
            Router,
            routing::{get, post},
        };
        use std::sync::atomic::{AtomicUsize, Ordering};
        let received = Arc::new(tokio::sync::Notify::new());
        let release = Arc::new(tokio::sync::Notify::new());
        let models = Arc::new(AtomicUsize::new(0));
        let app = Router::new()
            .route("/token", post({
                let received = received.clone(); let release = release.clone();
                move || { let received = received.clone(); let release = release.clone(); async move {
                    received.notify_one(); release.notified().await;
                    axum::Json(json!({"access_token":"rotated-access", "refresh_token":"rotated-refresh", "expires_in":3600, "token_type":"Bearer"}))
                }}
            }))
            .route("/v1/models", get({
                let models = models.clone();
                move || { let models = models.clone(); async move {
                    models.fetch_add(1, Ordering::SeqCst);
                    axum::Json(json!({"models":[{"slug":"test-model", "visibility":"list"}]}))
                }}
            }));
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        let server = tokio::spawn(async move {
            let _ = axum::serve(listener, app).await;
        });
        let (_directory, service) = test_service(&base).await;
        let mut account = service.store.load_active().unwrap().unwrap();
        account.expires_at = Some(super::super::store::now_secs() + 1);
        service.store.save(&account).unwrap();
        let request = {
            let service = service.clone();
            tokio::spawn(async move {
                generate_with_budget(
                    &service,
                    &json!({"instructions":"Commit", "input":"private diff"}),
                    &session::revision(&service.store).unwrap(),
                    Duration::from_millis(200),
                )
                .await
            })
        };
        tokio::time::timeout(Duration::from_secs(2), received.notified())
            .await
            .unwrap();
        let result = request.await.unwrap().unwrap();
        assert_eq!(result["code"], "generation_timeout");
        assert_eq!(models.load(Ordering::SeqCst), 0);
        release.notify_one();
        tokio::time::timeout(Duration::from_secs(2), async {
            while service
                .store
                .load(&account.client_id)
                .unwrap()
                .refresh_token
                .as_deref()
                != Some("rotated-refresh")
            {
                tokio::time::sleep(Duration::from_millis(5)).await;
            }
        })
        .await
        .unwrap();
        assert_eq!(models.load(Ordering::SeqCst), 0);
        server.abort();
    }

    #[tokio::test]
    async fn generate_sends_exact_public_responses_body_and_requires_completed() {
        let (base, captured, server) = mock_server(vec![response(
            b"data: {\"type\":\"response.output_text.delta\",\"delta\":\"Hello\"}\n\ndata: {\"type\":\"response.completed\",\"response\":{\"output\":[{\"type\":\"message\",\"content\":[{\"type\":\"output_text\",\"text\":\"ignored\"}]}]}}\n\n",
        )])
        .await;
        let (_directory, service) = test_service(&base).await;
        let result = generate(
            &service,
            &json!({
                "action": "chatgpt_generate",
                "model": "gpt-6.1-sol",
                "instructions": "Use concise prose.",
                "input": "Say hello.",
            }),
        )
        .await
        .unwrap();
        assert_eq!(result["outcome"], "completed");
        assert_eq!(result["text"], "Hello");
        let requests = captured.lock().await.clone();
        assert_eq!(requests.len(), 2);
        let response_request = requests
            .iter()
            .find(|request| request.path.ends_with("/v1/responses"))
            .unwrap();
        let body: Value = serde_json::from_slice(&response_request.body).unwrap();
        assert_eq!(
            body.as_object().unwrap().keys().collect::<Vec<_>>(),
            vec!["input", "instructions", "model", "store", "stream"]
        );
        assert_eq!(body["model"], "gpt-6.1-sol");
        assert_eq!(body["instructions"], "Use concise prose.");
        assert_eq!(body["store"], false);
        assert_eq!(body["stream"], true);
        assert_eq!(body["input"][0]["role"], "user");
        assert_eq!(body["input"][0]["content"][0]["type"], "input_text");
        assert_eq!(body["input"][0]["content"][0]["text"], "Say hello.");
        server.abort();
    }

    #[tokio::test]
    async fn model_catalog_401_refreshes_once_before_inference() {
        let (base, captured, server) = mock_server(vec![
            MockResponse {
                path: Some("/v1/models"),
                status: 401,
                content_type: "application/json",
                request_id: Some("req_models_expired"),
                body: br#"{"error":{"code":"subscription_sharing_invalid_user"}}"#.to_vec(),
            },
            MockResponse {
                path: Some("/token"),
                status: 200,
                content_type: "application/json",
                request_id: None,
                body: br#"{"access_token":"rotated-models","expires_in":3600,"refresh_token":"refresh-models","token_type":"Bearer","scope":"openid chatgpt.tokens.use.direct"}"#.to_vec(),
            },
            MockResponse {
                path: Some("/v1/models"),
                status: 200,
                content_type: "application/json",
                request_id: Some("req_models_retry"),
                body: br#"{"models":[{"slug":"gpt-6.1-sol","display_name":"Sol","visibility":"list"}]}"#.to_vec(),
            },
            response(b"data: {\"type\":\"response.completed\",\"response\":{\"output\":[]}}\n\n"),
        ])
        .await;
        let (_directory, service) = test_service(&base).await;
        let result = generate(
            &service,
            &json!({"action":"chatgpt_generate","instructions":"","input":"hello"}),
        )
        .await
        .unwrap();
        assert_eq!(result["outcome"], "completed");
        let requests = captured.lock().await.clone();
        let model_requests = requests
            .iter()
            .filter(|request| request.path.ends_with("/v1/models"))
            .collect::<Vec<_>>();
        let response_requests = requests
            .iter()
            .filter(|request| request.path.ends_with("/v1/responses"))
            .collect::<Vec<_>>();
        let token_requests = requests
            .iter()
            .filter(|request| request.path.ends_with("/token"))
            .collect::<Vec<_>>();
        assert_eq!(model_requests.len(), 2);
        assert_eq!(response_requests.len(), 1);
        assert_eq!(token_requests.len(), 1);
        assert_eq!(
            model_requests[0].authorization.as_deref(),
            Some("Bearer access")
        );
        assert_eq!(
            model_requests[1].authorization.as_deref(),
            Some("Bearer rotated-models")
        );
        assert_eq!(
            response_requests[0].authorization.as_deref(),
            Some("Bearer rotated-models")
        );
        server.abort();
    }

    #[tokio::test]
    async fn catalog_refresh_permanent_failure_requests_sign_in_recovery() {
        for code in ["invalid_grant", "invalid_client"] {
            let (base, captured, server) = mock_server(vec![
                MockResponse {
                    path: Some("/v1/models"),
                    status: 401,
                    content_type: "application/json",
                    request_id: Some("req_catalog"),
                    body: br#"{"error":{"code":"subscription_sharing_invalid_user"}}"#.to_vec(),
                },
                MockResponse {
                    path: Some("/token"),
                    status: 400,
                    content_type: "application/json",
                    request_id: None,
                    body: serde_json::to_vec(&json!({"error":code})).unwrap(),
                },
            ])
            .await;
            let (_directory, service) = test_service(&base).await;
            let result = generate(
                &service,
                &json!({
                    "action":"chatgpt_generate", "instructions":"", "input":"private input",
                }),
            )
            .await
            .unwrap();
            assert_eq!(result["reason"], "reconnect");
            assert_eq!(result["requestId"], "req_catalog");
            assert_eq!(
                result["code"],
                if code == "invalid_client" {
                    "invalid_client"
                } else {
                    "subscription_sharing_invalid_user"
                }
            );
            let requests = captured.lock().await.clone();
            assert_eq!(requests.len(), 2);
            assert!(
                requests
                    .iter()
                    .all(|request| !request.path.ends_with("/v1/responses"))
            );
            assert_eq!(
                service.store.load("issued_client").unwrap().state(),
                if code == "invalid_client" {
                    "client_invalid"
                } else {
                    "reconnect"
                }
            );
            server.abort();
        }
    }

    #[tokio::test]
    async fn catalog_refresh_scope_loss_does_not_send_input_to_responses() {
        let (base, captured, server) = mock_server(vec![
            MockResponse {
                path: Some("/v1/models"), status: 401,
                content_type: "application/json", request_id: None,
                body: br#"{"error":{"code":"subscription_sharing_invalid_user"}}"#.to_vec(),
            },
            MockResponse {
                path: Some("/token"), status: 200,
                content_type: "application/json", request_id: None,
                body: br#"{"access_token":"rotated","refresh_token":"rotated-refresh","expires_in":3600,"token_type":"Bearer","scope":"openid resource.invoke"}"#.to_vec(),
            },
            MockResponse {
                path: Some("/v1/models"), status: 200,
                content_type: "application/json", request_id: None,
                body: br#"{"models":[{"slug":"gpt-6.1-sol","display_name":"Sol","visibility":"list"}]}"#.to_vec(),
            },
        ]).await;
        let (_directory, service) = test_service(&base).await;
        let result = generate(
            &service,
            &json!({
                "action":"chatgpt_generate", "instructions":"", "input":"private input",
            }),
        )
        .await
        .unwrap();
        assert_eq!(result["reason"], "plan_disabled");
        let requests = captured.lock().await.clone();
        assert_eq!(requests.len(), 3);
        assert!(
            requests
                .iter()
                .all(|request| !request.path.ends_with("/v1/responses"))
        );
        assert_eq!(requests[2].authorization.as_deref(), Some("Bearer rotated"));
        server.abort();
    }

    #[tokio::test]
    async fn proactive_refresh_503_preserves_ready_credentials_and_reports_temporary() {
        let (base, captured, server) = mock_server(vec![MockResponse {
            path: Some("/token"),
            status: 503,
            content_type: "application/json",
            request_id: Some("req_refresh_unavailable"),
            body: br#"{"detail":"temporarily unavailable"}"#.to_vec(),
        }])
        .await;
        let (_directory, service) = test_service(&base).await;
        let mut account = service.store.load_active().unwrap().unwrap();
        account.expires_at = Some(0);
        service.store.save(&account).unwrap();

        let result = generate(
            &service,
            &json!({"action":"chatgpt_generate","instructions":"","input":"hello"}),
        )
        .await
        .unwrap();
        assert_eq!(result["outcome"], "failed");
        assert_eq!(result["reason"], "temporarily_unavailable");
        assert_eq!(result["code"], "refresh_unavailable");
        assert_eq!(
            service
                .store
                .load_active()
                .unwrap()
                .unwrap()
                .access_token
                .as_deref(),
            Some("access")
        );
        assert_eq!(captured.lock().await.len(), 1);
        server.abort();
    }

    #[tokio::test]
    async fn failed_event_after_delta_preserves_code_param_and_request_id() {
        let (base, _captured, server) = mock_server(vec![response(
            b"data: {\"type\":\"response.output_text.delta\",\"delta\":\"partial\"}\n\ndata: {\"type\":\"response.failed\",\"response\":{\"error\":{\"code\":\"subscription_sharing_usage_limit_exceeded\",\"param\":\"model\"}}}\n\n",
        )])
        .await;
        let (_directory, service) = test_service(&base).await;
        let result = generate(
            &service,
            &json!({"action":"chatgpt_generate","instructions":"","input":"hello"}),
        )
        .await
        .unwrap();
        assert_eq!(result["outcome"], "failed");
        assert_eq!(result["reason"], "usage_limit");
        assert_eq!(result["code"], "subscription_sharing_usage_limit_exceeded");
        assert_eq!(result["param"], "model");
        assert_eq!(result["httpStatus"], 200);
        assert_eq!(result["requestId"], "req_response");
        server.abort();
    }

    #[tokio::test]
    async fn model_429_is_returned_without_fallback_or_inference() {
        let (base, captured, server) = mock_server(vec![MockResponse {
            path: Some("/v1/models"),
            status: 429,
            content_type: "application/json",
            request_id: Some("req_limit"),
            body:
                br#"{"error":{"code":"subscription_sharing_usage_limit_exceeded","param":"model"}}"#
                    .to_vec(),
        }])
        .await;
        let (_directory, service) = test_service(&base).await;
        let result = generate(
            &service,
            &json!({"action":"chatgpt_generate","instructions":"","input":"hello"}),
        )
        .await
        .unwrap();
        assert_eq!(result["outcome"], "failed");
        assert_eq!(result["reason"], "usage_limit");
        assert_eq!(result["httpStatus"], 429);
        assert_eq!(result["requestId"], "req_limit");
        assert_eq!(captured.lock().await.len(), 1);
        server.abort();
    }

    #[tokio::test]
    async fn wrong_model_catalog_shape_is_rejected_without_curated_fallback() {
        let (base, captured, server) = mock_server(vec![MockResponse {
            path: Some("/v1/models"),
            status: 200,
            content_type: "application/json",
            request_id: Some("req_shape"),
            body: br#"{"data":[{"id":"gpt-4"}]}"#.to_vec(),
        }])
        .await;
        let (_directory, service) = test_service(&base).await;
        let result = generate(
            &service,
            &json!({"action":"chatgpt_generate","instructions":"","input":"hello"}),
        )
        .await
        .unwrap();
        assert_eq!(result["outcome"], "failed");
        assert_eq!(result["reason"], "failed");
        assert_eq!(result["code"], "invalid_model_catalog");
        assert_eq!(result["httpStatus"], 200);
        assert_eq!(result["requestId"], "req_shape");
        assert_eq!(captured.lock().await.len(), 1);
        server.abort();
    }

    #[tokio::test]
    async fn unauthorized_response_refreshes_once_and_retries_with_rotated_token() {
        let (base, captured, server) = mock_server(vec![
            MockResponse {
                path: Some("/v1/responses"),
                status: 401,
                content_type: "application/json",
                request_id: Some("req_expired"),
                body: br#"{"error":{"code":"subscription_sharing_invalid_user"}}"#.to_vec(),
            },
            MockResponse {
                path: Some("/token"),
                status: 200,
                content_type: "application/json",
                request_id: None,
                body: br#"{"access_token":"rotated","expires_in":3600,"refresh_token":"refresh-rotated","token_type":"Bearer","scope":"openid chatgpt.tokens.use.direct"}"#.to_vec(),
            },
            response(b"data: {\"type\":\"response.completed\",\"response\":{\"output\":[{\"type\":\"message\",\"content\":[{\"type\":\"output_text\",\"text\":\"retried\"}]}]}}\n\n"),
        ])
        .await;
        let (_directory, service) = test_service(&base).await;
        let result = generate(
            &service,
            &json!({"action":"chatgpt_generate","instructions":"","input":"hello"}),
        )
        .await
        .unwrap();
        assert_eq!(result["outcome"], "completed");
        assert_eq!(result["text"], "retried");
        let requests = captured.lock().await.clone();
        let response_requests = requests
            .iter()
            .filter(|request| request.path.ends_with("/v1/responses"))
            .collect::<Vec<_>>();
        assert_eq!(response_requests.len(), 2);
        assert_eq!(response_requests[0].body, response_requests[1].body);
        server.abort();
    }

    #[tokio::test]
    async fn unauthorized_response_refresh_503_preserves_credentials_and_is_temporary() {
        let (base, captured, server) = mock_server(vec![
            MockResponse {
                path: Some("/v1/responses"),
                status: 401,
                content_type: "application/json",
                request_id: Some("req_response_expired"),
                body: br#"{"error":{"code":"subscription_sharing_invalid_user"}}"#.to_vec(),
            },
            MockResponse {
                path: Some("/token"),
                status: 503,
                content_type: "application/json",
                request_id: Some("req_refresh_503"),
                body: br#"{"error":"temporarily_unavailable"}"#.to_vec(),
            },
        ])
        .await;
        let (_directory, service) = test_service(&base).await;
        let result = generate(
            &service,
            &json!({"action":"chatgpt_generate","instructions":"","input":"hello"}),
        )
        .await
        .unwrap();
        assert_eq!(result["outcome"], "failed");
        assert_eq!(result["reason"], "temporarily_unavailable");
        assert_eq!(result["code"], "refresh_unavailable");
        assert_eq!(result["httpStatus"], 401);
        assert_eq!(result["requestId"], "req_response_expired");
        let requests = captured.lock().await.clone();
        let response_requests = requests
            .iter()
            .filter(|request| request.path.ends_with("/v1/responses"))
            .collect::<Vec<_>>();
        assert_eq!(response_requests.len(), 1);
        assert_eq!(
            response_requests[0].authorization.as_deref(),
            Some("Bearer access")
        );
        assert_eq!(
            requests
                .iter()
                .filter(|request| request.path.ends_with("/token"))
                .count(),
            1
        );
        let saved = service.store.load_active().unwrap().unwrap();
        assert_eq!(saved.state(), "ready");
        assert_eq!(saved.access_token.as_deref(), Some("access"));
        assert_eq!(saved.refresh_token.as_deref(), Some("refresh"));
        server.abort();
    }

    #[tokio::test]
    async fn unauthorized_response_refresh_network_failure_preserves_credentials() {
        let (base, captured, server) = mock_server(vec![
            MockResponse {
                path: Some("/v1/responses"),
                status: 401,
                content_type: "application/json",
                request_id: Some("req_response_network"),
                body: br#"{"error":{"code":"subscription_sharing_invalid_user"}}"#.to_vec(),
            },
            MockResponse {
                path: Some("/token"),
                status: 0,
                content_type: "application/json",
                request_id: None,
                body: Vec::new(),
            },
        ])
        .await;
        let (_directory, service) = test_service(&base).await;

        let result = generate(
            &service,
            &json!({"action":"chatgpt_generate","instructions":"","input":"hello"}),
        )
        .await
        .unwrap();
        assert_eq!(result["outcome"], "failed");
        assert_eq!(result["reason"], "temporarily_unavailable");
        assert_eq!(result["code"], "refresh_unavailable");
        let requests = captured.lock().await.clone();
        let response_requests = requests
            .iter()
            .filter(|request| request.path.ends_with("/v1/responses"))
            .collect::<Vec<_>>();
        assert_eq!(response_requests.len(), 1);
        assert_eq!(
            response_requests[0].authorization.as_deref(),
            Some("Bearer access")
        );
        assert_eq!(
            requests
                .iter()
                .filter(|request| request.path.ends_with("/token"))
                .count(),
            1
        );
        let saved = service.store.load_active().unwrap().unwrap();
        assert_eq!(saved.state(), "ready");
        assert_eq!(saved.access_token.as_deref(), Some("access"));
        assert_eq!(saved.refresh_token.as_deref(), Some("refresh"));
        server.abort();
    }

    #[tokio::test]
    async fn unauthorized_response_invalid_grant_marks_registration_for_reconnect() {
        let (base, captured, server) = mock_server(vec![
            MockResponse {
                path: Some("/v1/responses"),
                status: 401,
                content_type: "application/json",
                request_id: Some("req_response_invalid_grant"),
                body: br#"{"error":{"code":"subscription_sharing_invalid_user"}}"#.to_vec(),
            },
            MockResponse {
                path: Some("/token"),
                status: 400,
                content_type: "application/json",
                request_id: Some("req_refresh_invalid_grant"),
                body: br#"{"error":"invalid_grant"}"#.to_vec(),
            },
        ])
        .await;
        let (_directory, service) = test_service(&base).await;
        let result = generate(
            &service,
            &json!({"action":"chatgpt_generate","instructions":"","input":"hello"}),
        )
        .await
        .unwrap();
        assert_eq!(result["outcome"], "failed");
        assert_eq!(result["reason"], "reconnect");
        assert_eq!(result["code"], "subscription_sharing_invalid_user");
        assert_eq!(result["httpStatus"], 401);
        let requests = captured.lock().await.clone();
        let response_requests = requests
            .iter()
            .filter(|request| request.path.ends_with("/v1/responses"))
            .collect::<Vec<_>>();
        assert_eq!(response_requests.len(), 1);
        assert_eq!(
            response_requests[0].authorization.as_deref(),
            Some("Bearer access")
        );
        assert_eq!(
            requests
                .iter()
                .filter(|request| request.path.ends_with("/token"))
                .count(),
            1
        );
        let saved = service.store.load_active().unwrap().unwrap();
        assert_eq!(saved.state(), "reconnect");
        assert_eq!(saved.client_id, "issued_client");
        assert_eq!(saved.subject, "subject");
        assert!(saved.access_token.is_none());
        assert!(saved.refresh_token.is_none());
        server.abort();
    }

    #[tokio::test]
    async fn unauthorized_response_invalid_client_preserves_client_invalid_state() {
        let (base, captured, server) = mock_server(vec![
            MockResponse {
                path: Some("/v1/responses"),
                status: 401,
                content_type: "application/json",
                request_id: Some("req_response_invalid_client"),
                body: br#"{"error":{"code":"subscription_sharing_invalid_user"}}"#.to_vec(),
            },
            MockResponse {
                path: Some("/token"),
                status: 401,
                content_type: "application/json",
                request_id: Some("req_refresh_invalid_client"),
                body: br#"{"error":"invalid_client"}"#.to_vec(),
            },
        ])
        .await;
        let (_directory, service) = test_service(&base).await;
        let result = generate(
            &service,
            &json!({"action":"chatgpt_generate","instructions":"","input":"hello"}),
        )
        .await
        .unwrap();
        assert_eq!(result["outcome"], "failed");
        assert_eq!(result["reason"], "reconnect");
        assert_eq!(result["code"], "invalid_client");
        assert_eq!(result["httpStatus"], 401);
        let requests = captured.lock().await.clone();
        let response_requests = requests
            .iter()
            .filter(|request| request.path.ends_with("/v1/responses"))
            .collect::<Vec<_>>();
        assert_eq!(response_requests.len(), 1);
        assert_eq!(
            response_requests[0].authorization.as_deref(),
            Some("Bearer access")
        );
        assert_eq!(
            requests
                .iter()
                .filter(|request| request.path.ends_with("/token"))
                .count(),
            1
        );
        let saved = service.store.load_active().unwrap().unwrap();
        assert_eq!(saved.state(), "client_invalid");
        assert_eq!(saved.client_id, "issued_client");
        assert_eq!(saved.subject, "subject");
        assert!(saved.access_token.is_none());
        assert!(saved.refresh_token.is_none());
        server.abort();
    }

    #[tokio::test]
    async fn unauthorized_response_scope_decline_is_plan_disabled_without_retry() {
        let (base, captured, server) = mock_server(vec![
            MockResponse {
                path: Some("/v1/responses"),
                status: 401,
                content_type: "application/json",
                request_id: Some("req_response_scope"),
                body: br#"{"error":{"code":"subscription_sharing_invalid_user"}}"#.to_vec(),
            },
            MockResponse {
                path: Some("/token"),
                status: 200,
                content_type: "application/json",
                request_id: None,
                body: br#"{"access_token":"scope-access","expires_in":3600,"refresh_token":"scope-refresh","token_type":"Bearer","scope":"openid profile email offline_access"}"#.to_vec(),
            },
        ])
        .await;
        let (_directory, service) = test_service(&base).await;
        let result = generate(
            &service,
            &json!({"action":"chatgpt_generate","instructions":"","input":"hello"}),
        )
        .await
        .unwrap();
        assert_eq!(result["outcome"], "failed");
        assert_eq!(result["reason"], "plan_disabled");
        assert_eq!(result["code"], "chatpass_v2_scope_not_authorized");
        let requests = captured.lock().await.clone();
        let response_requests = requests
            .iter()
            .filter(|request| request.path.ends_with("/v1/responses"))
            .collect::<Vec<_>>();
        assert_eq!(response_requests.len(), 1);
        assert_eq!(
            response_requests[0].authorization.as_deref(),
            Some("Bearer access")
        );
        assert_eq!(
            requests
                .iter()
                .filter(|request| request.path.ends_with("/token"))
                .count(),
            1
        );
        let saved = service.store.load_active().unwrap().unwrap();
        assert_eq!(saved.state(), "plan_disabled");
        assert_eq!(saved.access_token.as_deref(), Some("scope-access"));
        assert_eq!(saved.refresh_token.as_deref(), Some("scope-refresh"));
        server.abort();
    }

    #[tokio::test]
    async fn pre_stream_403_preserves_route_error_and_request_id() {
        let (base, _captured, server) = mock_server(vec![MockResponse {
            path: Some("/v1/responses"),
            status: 403,
            content_type: "application/json",
            request_id: Some("req_route"),
            body: br#"{"error":{"code":"subscription_sharing_route_not_supported","param":"endpoint"}}"#.to_vec(),
        }])
        .await;
        let (_directory, service) = test_service(&base).await;
        let result = generate(
            &service,
            &json!({"action":"chatgpt_generate","instructions":"","input":"hello"}),
        )
        .await
        .unwrap();
        assert_eq!(result["outcome"], "failed");
        assert_eq!(result["reason"], "route_not_supported");
        assert_eq!(result["param"], "endpoint");
        assert_eq!(result["httpStatus"], 403);
        assert_eq!(result["requestId"], "req_route");
        server.abort();
    }

    #[tokio::test]
    async fn eof_after_delta_is_interrupted() {
        let (base, _captured, server) = mock_server(vec![response(
            b"data: {\"type\":\"response.output_text.delta\",\"delta\":\"partial\"}\n\n",
        )])
        .await;
        let (_directory, service) = test_service(&base).await;
        let result = generate(
            &service,
            &json!({"action":"chatgpt_generate","instructions":"","input":"hello"}),
        )
        .await
        .unwrap();
        assert_eq!(result["outcome"], "failed");
        assert_eq!(result["reason"], "interrupted");
        assert_eq!(result["code"], "stream_eof");
        server.abort();
    }

    #[tokio::test]
    async fn oversized_stream_delta_is_rejected_before_completed() {
        let delta = "x".repeat(MAX_OUTPUT_CHARS + 1);
        let body = format!(
            "data: {{\"type\":\"response.output_text.delta\",\"delta\":{}}}\n\n",
            serde_json::to_string(&delta).unwrap()
        );
        let (base, _captured, server) = mock_server(vec![response(body.into_bytes())]).await;
        let (_directory, service) = test_service(&base).await;
        let result = generate(
            &service,
            &json!({"action":"chatgpt_generate","instructions":"","input":"hello"}),
        )
        .await
        .unwrap();
        assert_eq!(result["outcome"], "failed");
        assert_eq!(result["reason"], "failed");
        assert_eq!(result["code"], "output_too_large");
        server.abort();
    }
}
