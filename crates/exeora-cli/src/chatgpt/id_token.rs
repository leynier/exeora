use anyhow::{Context, Result, bail};
use jsonwebtoken::{
    Algorithm, DecodingKey, Validation, decode, decode_header,
    jwk::{
        AlgorithmParameters, Jwk, JwkSet, KeyAlgorithm, KeyOperations, PublicKeyUse, RSAKeyType,
    },
};
use serde::Deserialize;
use serde_json::Value;
use url::Url;

use super::{EndpointConfig, MAX_DISCOVERY_BYTES, MAX_JWKS_BYTES};

const OPENAI_ISSUER: &str = "https://auth.openai.com";
const OPENAI_AUTH_HOST: &str = "auth.openai.com";
const MAX_CLOCK_SKEW_SECS: u64 = 5;
const MAX_IDENTITY_FIELD_BYTES: usize = 1_280;
const MAX_PUBLIC_LABEL_UTF16: usize = 256;
const MAX_PUBLIC_EMAIL_UTF16: usize = 320;

#[derive(Debug, Clone)]
pub(crate) struct Discovery {
    pub issuer: String,
    pub jwks_uri: Url,
    pub revocation_endpoint: Option<Url>,
    pub supported_algorithms: Vec<Algorithm>,
}

#[derive(Debug, Deserialize)]
struct DiscoveryResponse {
    issuer: String,
    jwks_uri: String,
    #[serde(default)]
    revocation_endpoint: Option<String>,
    #[serde(default)]
    id_token_signing_alg_values_supported: Vec<String>,
}

#[derive(Debug, Clone)]
pub(crate) struct VerifiedIdentity {
    pub issuer: String,
    pub subject: String,
    pub email: Option<String>,
    pub label: Option<String>,
}

#[derive(Debug)]
pub(crate) enum VerifyError {
    UnknownKid,
    Invalid(anyhow::Error),
}

impl std::fmt::Display for VerifyError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::UnknownKid => f.write_str("The ID token signing key is not in the cached JWKS."),
            Self::Invalid(error) => error.fmt(f),
        }
    }
}

impl std::error::Error for VerifyError {}

pub(crate) async fn discover(
    http: &reqwest::Client,
    endpoints: &EndpointConfig,
) -> Result<Discovery> {
    let response = http
        .get(endpoints.discovery.as_str())
        .send()
        .await
        .context("Could not reach OpenAI discovery.")?;
    let status = response.status();
    let bytes = super::read_bounded(response, MAX_DISCOVERY_BYTES).await?;
    if !status.is_success() {
        bail!("OpenAI discovery returned HTTP {}.", status.as_u16());
    }
    let value: DiscoveryResponse =
        serde_json::from_slice(&bytes).context("OpenAI discovery metadata is invalid.")?;
    validate_issuer(&value.issuer)?;
    let jwks_uri = validate_auth_url(&value.jwks_uri, "jwks_uri")?;
    let revocation_endpoint = value
        .revocation_endpoint
        .as_deref()
        .map(|value| validate_auth_url(value, "revocation_endpoint"))
        .transpose()?;
    if value.id_token_signing_alg_values_supported.as_slice() != ["RS256"] {
        bail!("OpenAI discovery did not advertise exactly RS256 for ID tokens.");
    }
    Ok(Discovery {
        // Url normalizes an origin-only URL to a trailing slash. Keep the
        // exact discovery string because OIDC issuer comparison is exact.
        issuer: OPENAI_ISSUER.to_owned(),
        jwks_uri,
        revocation_endpoint,
        supported_algorithms: vec![Algorithm::RS256],
    })
}

pub(crate) async fn fetch_jwks(http: &reqwest::Client, discovery: &Discovery) -> Result<JwkSet> {
    if discovery.issuer != OPENAI_ISSUER {
        bail!("OpenAI discovery returned an unexpected issuer.");
    }
    validate_auth_url(discovery.jwks_uri.as_str(), "jwks_uri")?;
    let response = http
        .get(discovery.jwks_uri.as_str())
        .send()
        .await
        .context("Could not fetch OpenAI signing keys.")?;
    let status = response.status();
    let bytes = super::read_bounded(response, MAX_JWKS_BYTES).await?;
    if !status.is_success() {
        bail!("OpenAI signing keys returned HTTP {}.", status.as_u16());
    }
    let keys: JwkSet =
        serde_json::from_slice(&bytes).context("OpenAI signing keys are invalid.")?;
    if keys.keys.len() > 64 {
        bail!("OpenAI returned too many signing keys.");
    }
    Ok(keys)
}

pub(crate) fn verify_with_jwks(
    token: &str,
    discovery: &Discovery,
    jwks: &JwkSet,
    client_id: &str,
    nonce: &str,
) -> std::result::Result<VerifiedIdentity, VerifyError> {
    if token.len() > 64 * 1024 {
        return Err(VerifyError::Invalid(anyhow::anyhow!(
            "The ID token is too large."
        )));
    }
    if discovery.issuer != OPENAI_ISSUER
        || validate_auth_url(discovery.jwks_uri.as_str(), "jwks_uri").is_err()
    {
        return Err(VerifyError::Invalid(anyhow::anyhow!(
            "The ID token discovery metadata is not official."
        )));
    }
    if client_id.trim().is_empty() || nonce.is_empty() {
        return Err(VerifyError::Invalid(anyhow::anyhow!(
            "The ID token validation context is incomplete."
        )));
    }
    let header = decode_header(token).map_err(|error| VerifyError::Invalid(error.into()))?;
    if header.alg != Algorithm::RS256 || !discovery.supported_algorithms.contains(&Algorithm::RS256)
    {
        return Err(VerifyError::Invalid(anyhow::anyhow!(
            "The ID token uses an unsupported signing algorithm."
        )));
    }
    let Some(kid) = header.kid.as_deref() else {
        return Err(VerifyError::Invalid(anyhow::anyhow!(
            "The ID token has no signing key identifier."
        )));
    };
    if kid.is_empty() || kid.len() > 256 {
        return Err(VerifyError::Invalid(anyhow::anyhow!(
            "The ID token signing key identifier is invalid."
        )));
    }
    let Some(jwk) = jwks.find(kid) else {
        return Err(VerifyError::UnknownKid);
    };
    validate_jwk(jwk, header.alg).map_err(VerifyError::Invalid)?;
    let key = DecodingKey::from_jwk(jwk)
        .map_err(|error| VerifyError::Invalid(anyhow::anyhow!(error.to_string())))?;
    let mut validation = Validation::new(header.alg);
    validation.set_issuer(&[discovery.issuer.as_str()]);
    validation.set_audience(&[client_id]);
    validation.set_required_spec_claims(&["exp", "iss", "aud", "sub"]);
    validation.leeway = MAX_CLOCK_SKEW_SECS;
    let data = decode::<Claims>(token, &key, &validation)
        .map_err(|error| VerifyError::Invalid(anyhow::anyhow!(error.to_string())))?;
    if data.claims.iss != discovery.issuer
        || data.claims.sub.trim().is_empty()
        || !audience_contains(&data.claims.aud, client_id)
    {
        return Err(VerifyError::Invalid(anyhow::anyhow!(
            "The ID token claims are not for this registration."
        )));
    }
    let Some(returned_nonce) = data.claims.nonce.as_deref() else {
        return Err(VerifyError::Invalid(anyhow::anyhow!(
            "The ID token has no nonce."
        )));
    };
    if !constant_time_eq(returned_nonce.as_bytes(), nonce.as_bytes()) {
        return Err(VerifyError::Invalid(anyhow::anyhow!(
            "The ID token nonce does not match the sign-in attempt."
        )));
    }
    if data.claims.iat.is_some_and(|issued_at| {
        issued_at > jsonwebtoken::get_current_timestamp().saturating_add(MAX_CLOCK_SKEW_SECS)
    }) {
        return Err(VerifyError::Invalid(anyhow::anyhow!(
            "The ID token was issued in the future."
        )));
    }
    Ok(VerifiedIdentity {
        issuer: data.claims.iss,
        subject: data.claims.sub,
        email: bounded_identity_field(data.claims.email, MAX_PUBLIC_EMAIL_UTF16),
        label: bounded_identity_field(data.claims.name, MAX_PUBLIC_LABEL_UTF16),
    })
}

#[derive(Debug, Deserialize)]
struct Claims {
    iss: String,
    sub: String,
    aud: Value,
    #[serde(default)]
    iat: Option<u64>,
    #[serde(default)]
    nonce: Option<String>,
    #[serde(default)]
    email: Option<String>,
    #[serde(default)]
    name: Option<String>,
}

fn audience_contains(aud: &Value, expected: &str) -> bool {
    match aud {
        Value::String(value) => value == expected,
        Value::Array(values) => values.iter().any(|value| value.as_str() == Some(expected)),
        _ => false,
    }
}

fn validate_jwk(jwk: &Jwk, algorithm: Algorithm) -> Result<()> {
    if jwk
        .common
        .public_key_use
        .as_ref()
        .is_some_and(|usage| usage != &PublicKeyUse::Signature)
    {
        bail!("The signing key is not intended for signature verification.");
    }
    if jwk
        .common
        .key_operations
        .as_ref()
        .is_some_and(|operations| {
            !operations
                .iter()
                .any(|operation| operation == &KeyOperations::Verify)
        })
    {
        bail!("The signing key cannot verify signatures.");
    }
    if jwk.common.key_algorithm.is_some_and(|advertised| {
        advertised != KeyAlgorithm::RS256 || algorithm != Algorithm::RS256
    }) {
        bail!("The signing key algorithm does not match the ID token.");
    }
    match (&jwk.algorithm, algorithm) {
        (AlgorithmParameters::RSA(parameters), Algorithm::RS256)
            if parameters.key_type == RSAKeyType::RSA =>
        {
            Ok(())
        }
        _ => bail!("The signing key type does not match the ID token algorithm."),
    }
}

fn validate_issuer(value: &str) -> Result<Url> {
    if value != OPENAI_ISSUER {
        bail!("OpenAI issuer must be https://auth.openai.com.");
    }
    validate_auth_url(value, "issuer")
}

pub(crate) fn validate_auth_url(value: &str, field: &str) -> Result<Url> {
    let url = Url::parse(value).with_context(|| format!("OpenAI {field} is invalid."))?;
    if url.scheme() != "https"
        || url.host_str() != Some(OPENAI_AUTH_HOST)
        || url.port_or_known_default() != Some(443)
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        bail!("OpenAI {field} must stay on https://auth.openai.com.");
    }
    Ok(url)
}

pub(crate) fn public_profile(email: Option<&str>, label: Option<&str>) -> (Option<String>, String) {
    let email = bounded_identity_field(email.map(str::to_owned), MAX_PUBLIC_EMAIL_UTF16);
    let label = bounded_identity_field(label.map(str::to_owned), MAX_PUBLIC_LABEL_UTF16)
        .or_else(|| bounded_identity_field(email.clone(), MAX_PUBLIC_LABEL_UTF16))
        .unwrap_or_else(|| "ChatGPT account".to_owned());
    (email, label)
}

fn bounded_identity_field(value: Option<String>, max_utf16: usize) -> Option<String> {
    value.filter(|value| {
        !value.is_empty()
            && value.len() <= MAX_IDENTITY_FIELD_BYTES
            && value.encode_utf16().count() <= max_utf16
            && !value.contains('\0')
    })
}

fn constant_time_eq(left: &[u8], right: &[u8]) -> bool {
    if left.len() != right.len() {
        return false;
    }
    let mut difference = 0_u8;
    for index in 0..left.len().max(right.len()) {
        difference |= left.get(index).copied().unwrap_or_default()
            ^ right.get(index).copied().unwrap_or_default();
    }
    difference == 0
}

#[cfg(test)]
mod tests {
    use base64::Engine as _;
    use serde::Serialize;

    use super::*;

    #[test]
    fn rejects_non_openai_discovery_endpoints() {
        assert!(validate_auth_url("https://evil.example/jwks", "jwks_uri").is_err());
        assert!(validate_auth_url("http://auth.openai.com/jwks", "jwks_uri").is_err());
        assert!(validate_auth_url("https://auth.openai.com/jwks?next=evil", "jwks_uri").is_err());
        assert!(validate_auth_url("https://auth.openai.com/jwks", "jwks_uri").is_ok());
    }

    #[test]
    fn constant_time_comparison_requires_equal_values_and_lengths() {
        assert!(constant_time_eq(b"same", b"same"));
        assert!(!constant_time_eq(b"same", b"same!"));
        assert!(!constant_time_eq(b"same", b"diff"));
    }

    #[test]
    fn audience_must_be_the_issued_client() {
        assert!(audience_contains(&serde_json::json!("client"), "client"));
        assert!(audience_contains(
            &serde_json::json!(["other", "client"]),
            "client"
        ));
        assert!(!audience_contains(&serde_json::json!("other"), "client"));
    }

    const KID: &str = "openai-test-key";
    const CLIENT_ID: &str = "issued-client-id";
    const NONCE: &str = "oauth-nonce";
    // AWS-LC's RSA signer expects a PKCS#1 DER key. This fixture is test-only.
    const RSA_PRIVATE_DER_B64: &str = "MIIEpQIBAAKCAQEAlPWZd19WJMoXD7/tc45DIasahGQhRHY2gtDoqQAQAVaFpC6+1SO7az8lLdFzuFGwCNv1KTMwRbIBRO8sAu5bq3P33zRxS4mdmjMousEy7SbUiW6m8lnPD/wNV6JALqadJN3V4FV6pGh5DMYAuRZhUYMUliCVyijqFaf38zVMSneS7U8x2Qa6Dw5cFqxg8S+lpTh/pFdjsTEz+83OHgbPOfvSk3/seYoLxdYojvkdrsGJrxmLly0B/L+z2GO/Ct2MQVtwcHLPqYdwjerJaqA2lc2gypkHYTDU+6yqQhhfgivXws5QnG//djWWFaXjr1N+5VCFZTGox7kTMPU8fymxTwIDAQABAoIBAAEIcJ7yPT5WL3zfadoCtBLTlFdgzp2LvyNg3G7/lqRaysZ1SEro6ZVWVqUxosJFC+zB65w/xCd1sSLqEIFcsrr7aSD7taVroVsZNwRipD48xDn07iDbo/0/F/ryEIGGE6xtL77bGOSgY24Jt5bcSTkv1fzUDyMJC/OxyawoFtCkbs7lk0vMlIZFgzNOimJTNx9B59TNx6A5tJLukfvzlNxM9EUdGvVH7ccFkvsGZ3OEHhsmNXgpZZmhe55+pTAIO5Sy7TGUqp1tqaSEpsZI/vanDQki4kf7yVs06XPFs0m5O1lV80qaaxpVjsiybayN6G82Or1SBkqN2CuC/Q2rNYECgYEAxXf0m9QetGnK9+piySAZVkB5RyVENAy2Ls+3JC18z/NJqCSsdnJqEYGVSwZM4vNIwOPZRCFZ9Rwqqgx2xjUTj0t7TkAEJmKl7w9Y4wlVsldiclyMPGgMljVzygIVTX+tRkYOKCePMRp5O0luht1dEd52yehU7Iqk2Ul6ErhkRWECgYEAwRy75NW5yEOPkU4ZMQI4SVydAjgvxXm3NOzRsO91U9YkSszzGPdiHXNWu6n0l8DzMtdEb9/252La2F86FxH1BDBv7uAxL2twHIeumHMMUJ5vdzidlstPoEtF9SMhwJ+ok1rAVb0Cs/TpHp0k/uR9DyeLj7z6gqfUVPlAZR2AxK8CgYEAwmRoRM74uxo6WPw/60bSKnql6UficGrjHgoVfGPbLsuNgx03OhNAH6O1WHoHTpO410p2I//BEu57gZNriYvOiY4BAPM8Ip2SRFiTZE1YM4yauYIp+31ihqxwJDkQx44dAcUNQrJO4EPzfE25pMJeUKzzu6gfkgyaY91VcwBalYECgYEAtbh7W5h/beOdqyep7wNewjJDkX4b/iFOdKBRpsV/S/gcSMNaE2lfy8TonkoNX+xzLqmBviEsb4sH00qxGFqOjXWjL0+LGUtpwX8wnkbNFOQykicVrHv/nyCWYVrA/UmA0cE5crUdYQibgnJwCOgsguE8pHM57U9PMPMoVL6RmQMCgYEAkuxQsSyfAQQ1R/ZnCqt1LpBlTIhK6zp2V++Zfhrmi9lTZVMvkahKwCzJAEDNcvN+Y/ypKagL/LZ69dnFRTmmRCEXTfcY8V8gx8MHbJV2S1I/rZ1MLF/JCUCzmZJovS8tHLw5miLPfb6WPjJLPR5IpFeLLiUHza9k6d2L0ucpTWE=";

    #[derive(Debug, Serialize)]
    struct TestClaims {
        iss: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        sub: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        aud: Option<Value>,
        #[serde(skip_serializing_if = "Option::is_none")]
        exp: Option<u64>,
        #[serde(skip_serializing_if = "Option::is_none")]
        iat: Option<u64>,
        #[serde(skip_serializing_if = "Option::is_none")]
        nonce: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        email: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        name: Option<String>,
    }

    fn signing_key() -> jsonwebtoken::EncodingKey {
        let der = base64::engine::general_purpose::STANDARD
            .decode(RSA_PRIVATE_DER_B64)
            .unwrap();
        jsonwebtoken::EncodingKey::from_rsa_der(&der)
    }

    fn discovery() -> Discovery {
        Discovery {
            issuer: OPENAI_ISSUER.to_owned(),
            jwks_uri: Url::parse("https://auth.openai.com/.well-known/jwks.json").unwrap(),
            revocation_endpoint: None,
            supported_algorithms: vec![Algorithm::RS256],
        }
    }

    fn jwks() -> JwkSet {
        let mut jwk = Jwk::from_encoding_key(&signing_key(), Algorithm::RS256).unwrap();
        jwk.common.key_id = Some(KID.to_owned());
        JwkSet { keys: vec![jwk] }
    }

    fn claims() -> TestClaims {
        let now = jsonwebtoken::get_current_timestamp();
        TestClaims {
            iss: OPENAI_ISSUER.to_owned(),
            sub: Some("chatgpt-subject".to_owned()),
            aud: Some(Value::String(CLIENT_ID.to_owned())),
            exp: Some(now + 60),
            iat: Some(now),
            nonce: Some(NONCE.to_owned()),
            email: Some("person@example.test".to_owned()),
            name: Some("Person".to_owned()),
        }
    }

    fn token(claims: &TestClaims) -> String {
        let mut header = jsonwebtoken::Header::new(Algorithm::RS256);
        header.kid = Some(KID.to_owned());
        jsonwebtoken::encode(&header, claims, &signing_key()).unwrap()
    }

    fn verify(token: &str) -> std::result::Result<VerifiedIdentity, VerifyError> {
        verify_with_jwks(token, &discovery(), &jwks(), CLIENT_ID, NONCE)
    }

    #[test]
    fn accepts_a_signed_openai_identity_token() {
        let identity = verify(&token(&claims())).unwrap();
        assert_eq!(identity.issuer, OPENAI_ISSUER);
        assert_eq!(identity.subject, "chatgpt-subject");
        assert_eq!(identity.email.as_deref(), Some("person@example.test"));
        assert_eq!(identity.label.as_deref(), Some("Person"));
    }

    #[test]
    fn verified_identity_fields_fit_the_public_status_limits() {
        let mut profile = claims();
        profile.name = Some("x".repeat(257));
        profile.email = Some("x".repeat(321));
        let identity = verify(&token(&profile)).unwrap();
        assert!(identity.label.is_none());
        assert!(identity.email.is_none());
        profile.name = Some("😀".repeat(128));
        profile.email = Some("person@example.test".to_owned());
        let identity = verify(&token(&profile)).unwrap();
        assert_eq!(identity.label.unwrap().encode_utf16().count(), 256);
        assert_eq!(identity.email.as_deref(), Some("person@example.test"));
    }

    #[test]
    fn rejects_tampered_signature() {
        let mut parts = token(&claims())
            .split('.')
            .map(str::to_owned)
            .collect::<Vec<_>>();
        let signature = parts.get_mut(2).unwrap();
        let first = signature.as_bytes()[0];
        signature.replace_range(0..1, if first == b'A' { "B" } else { "A" });
        assert!(matches!(
            verify(&parts.join(".")),
            Err(VerifyError::Invalid(_))
        ));
    }

    #[test]
    fn rejects_wrong_issuer_audience_and_nonce() {
        let mut wrong_issuer = claims();
        wrong_issuer.iss = "https://auth.openai.com/other".to_owned();
        assert!(matches!(
            verify(&token(&wrong_issuer)),
            Err(VerifyError::Invalid(_))
        ));

        let mut wrong_audience = claims();
        wrong_audience.aud = Some(Value::String("different-client".to_owned()));
        assert!(matches!(
            verify(&token(&wrong_audience)),
            Err(VerifyError::Invalid(_))
        ));

        let mut wrong_nonce = claims();
        wrong_nonce.nonce = Some("different-nonce".to_owned());
        assert!(matches!(
            verify(&token(&wrong_nonce)),
            Err(VerifyError::Invalid(_))
        ));
    }

    #[test]
    fn rejects_signed_nonce_with_256_appended_zero_bytes() {
        let mut extended = claims();
        extended.nonce = Some(format!("{NONCE}{}", "\0".repeat(256)));
        assert!(matches!(
            verify(&token(&extended)),
            Err(VerifyError::Invalid(_))
        ));
    }

    #[test]
    fn rejects_expired_and_future_issued_tokens() {
        let mut expired = claims();
        expired.exp = Some(jsonwebtoken::get_current_timestamp() - 60);
        assert!(matches!(
            verify(&token(&expired)),
            Err(VerifyError::Invalid(_))
        ));

        let mut future = claims();
        future.iat = Some(jsonwebtoken::get_current_timestamp() + MAX_CLOCK_SKEW_SECS + 1);
        assert!(matches!(
            verify(&token(&future)),
            Err(VerifyError::Invalid(_))
        ));
    }

    #[test]
    fn rejects_missing_required_claims_and_empty_subject() {
        let mut missing_sub = claims();
        missing_sub.sub = None;
        assert!(matches!(
            verify(&token(&missing_sub)),
            Err(VerifyError::Invalid(_))
        ));

        let mut missing_aud = claims();
        missing_aud.aud = None;
        assert!(matches!(
            verify(&token(&missing_aud)),
            Err(VerifyError::Invalid(_))
        ));

        let mut missing_exp = claims();
        missing_exp.exp = None;
        assert!(matches!(
            verify(&token(&missing_exp)),
            Err(VerifyError::Invalid(_))
        ));

        let mut empty_sub = claims();
        empty_sub.sub = Some("   ".to_owned());
        assert!(matches!(
            verify(&token(&empty_sub)),
            Err(VerifyError::Invalid(_))
        ));
    }

    #[test]
    fn rejects_none_and_hmac_algorithm_confusion() {
        let mut hmac_header = jsonwebtoken::Header::new(Algorithm::HS256);
        hmac_header.kid = Some(KID.to_owned());
        let hmac = jsonwebtoken::encode(
            &hmac_header,
            &claims(),
            &jsonwebtoken::EncodingKey::from_secret(b"attacker-secret"),
        )
        .unwrap();
        assert!(matches!(verify(&hmac), Err(VerifyError::Invalid(_))));

        let signed = token(&claims());
        let mut segments = signed.split('.');
        let _header = segments.next().unwrap();
        let payload = segments.next().unwrap();
        let signature = segments.next().unwrap();
        let none_header = base64::engine::general_purpose::URL_SAFE_NO_PAD
            .encode(br#"{"alg":"none","kid":"openai-test-key"}"#);
        let none = format!("{none_header}.{payload}.{signature}");
        assert!(matches!(verify(&none), Err(VerifyError::Invalid(_))));
    }

    #[test]
    fn rejects_wrong_key_algorithm_and_unknown_key_id() {
        let mut wrong_algorithm = jwks();
        wrong_algorithm.keys[0].common.key_algorithm = Some(KeyAlgorithm::HS256);
        assert!(matches!(
            verify_with_jwks(
                &token(&claims()),
                &discovery(),
                &wrong_algorithm,
                CLIENT_ID,
                NONCE
            ),
            Err(VerifyError::Invalid(_))
        ));

        let mut unknown_key_header = jsonwebtoken::Header::new(Algorithm::RS256);
        unknown_key_header.kid = Some("rotated-key".to_owned());
        let unknown_key =
            jsonwebtoken::encode(&unknown_key_header, &claims(), &signing_key()).unwrap();
        assert!(matches!(verify(&unknown_key), Err(VerifyError::UnknownKid)));
    }

    #[test]
    fn rejects_non_official_issuer_metadata() {
        assert!(validate_issuer("https://auth.openai.com/other").is_err());
        assert!(validate_auth_url("https://auth.openai.com:444/jwks", "jwks_uri").is_err());
        let mut untrusted = discovery();
        untrusted.issuer = "https://auth.openai.com/other".to_owned();
        assert!(matches!(
            verify_with_jwks(&token(&claims()), &untrusted, &jwks(), CLIENT_ID, NONCE),
            Err(VerifyError::Invalid(_))
        ));
    }
}
