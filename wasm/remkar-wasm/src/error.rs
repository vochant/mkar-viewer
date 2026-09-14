use serde::Serialize;
use std::fmt::{Display, Formatter};

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum MkarErrorCode {
    InvalidArchive,
    UnsupportedVersion,
    LimitExceeded,
    UnsupportedFeature,
    PasswordRequired,
    #[allow(dead_code)] // Reserved by the public API for the future decryptor.
    IncorrectPassword,
    InvalidEntry,
}

impl MkarErrorCode {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::InvalidArchive => "INVALID_ARCHIVE",
            Self::UnsupportedVersion => "UNSUPPORTED_VERSION",
            Self::LimitExceeded => "LIMIT_EXCEEDED",
            Self::UnsupportedFeature => "UNSUPPORTED_FEATURE",
            Self::PasswordRequired => "PASSWORD_REQUIRED",
            Self::IncorrectPassword => "INCORRECT_PASSWORD",
            Self::InvalidEntry => "INVALID_ENTRY",
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MkarErrorDetails {
    pub code: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub entry: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub key_index: Option<u32>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MkarError {
    pub code: MkarErrorCode,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub entry: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub key_index: Option<u32>,
}

impl MkarError {
    pub fn new(code: MkarErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
            entry: None,
            key_index: None,
        }
    }

    pub fn with_entry(mut self, entry: u32) -> Self {
        self.entry = Some(entry);
        self
    }

    pub fn with_key_index(mut self, key_index: u32) -> Self {
        self.key_index = Some(key_index);
        self
    }

    pub fn password_required(key_index: u32, entry: u32) -> Self {
        Self::new(
            MkarErrorCode::PasswordRequired,
            format!("Archive entry {entry} requires password key {key_index}"),
        )
        .with_entry(entry)
        .with_key_index(key_index)
    }

    pub fn details(&self) -> MkarErrorDetails {
        MkarErrorDetails {
            code: self.code.as_str().to_string(),
            message: self.message.clone(),
            entry: self.entry,
            key_index: self.key_index,
        }
    }
}

impl Display for MkarError {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.message)
    }
}

impl std::error::Error for MkarError {}

#[cfg(test)]
mod tests {
    use super::MkarError;

    #[test]
    fn error_details_include_password_key_index() {
        let details = MkarError::password_required(7, 3).details();

        assert_eq!(details.code, "PASSWORD_REQUIRED");
        assert_eq!(details.entry, Some(3));
        assert_eq!(details.key_index, Some(7));
    }
}
