use serde::{Deserialize, Serialize};
use std::collections::HashMap;

pub const MAX_ARCHIVE_BYTES: usize = 64 * 1024 * 1024;
pub const MAX_ENTRIES: usize = 10_000;
pub const MAX_ENTRY_BYTES: usize = 64 * 1024 * 1024;
pub const MAX_TOTAL_BYTES: usize = 256 * 1024 * 1024;
pub const MAX_DEPTH: usize = 128;
pub const MAX_NAME_BYTES: usize = 1_024;

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum EntryKind {
    File,
    Folder,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveEntry {
    pub path: String,
    pub kind: EntryKind,
    #[serde(default, with = "serde_bytes")]
    pub content: Vec<u8>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EntryPrefix {
    pub prop: u8,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EntryMetadata {
    pub prop: u8,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub key_index: Option<u32>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DecodedStoredEntry {
    pub prop: u8,
    #[serde(default, with = "serde_bytes")]
    pub content: Vec<u8>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ManifestInput {
    pub name: String,
    pub prop: u8,
    pub source_index: u32,
    pub stored_size: usize,
    #[serde(default)]
    pub locked: bool,
    #[serde(default)]
    pub loaded: bool,
    #[serde(default)]
    pub key_index: Option<u32>,
    #[serde(default, with = "serde_bytes")]
    pub data: Vec<u8>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ManifestEntry {
    pub path: String,
    pub kind: EntryKind,
    pub source_index: u32,
    pub size: usize,
    pub encrypted: bool,
    pub locked: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub key_index: Option<u32>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlannedArchiveEntry {
    pub path: String,
    pub name: String,
    pub kind: EntryKind,
    pub children: Vec<u32>,
    pub root: bool,
    #[serde(default)]
    pub key_index: Option<u32>,
    #[serde(default)]
    pub compressed: bool,
}

impl ArchiveEntry {
    pub fn file(path: impl Into<String>, content: impl AsRef<[u8]>) -> Self {
        Self {
            path: path.into(),
            kind: EntryKind::File,
            content: content.as_ref().to_vec(),
        }
    }

    pub fn folder(path: impl Into<String>) -> Self {
        Self {
            path: path.into(),
            kind: EntryKind::Folder,
            content: Vec::new(),
        }
    }
}

#[derive(Clone, Copy, Debug, Default, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct RequestedLimits {
    pub max_archive_bytes: Option<usize>,
    pub max_entries: Option<usize>,
    pub max_entry_bytes: Option<usize>,
    pub max_total_bytes: Option<usize>,
    pub max_depth: Option<usize>,
    pub max_name_bytes: Option<usize>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct DecodeLimits {
    pub max_archive_bytes: usize,
    pub max_entries: usize,
    pub max_entry_bytes: usize,
    pub max_total_bytes: usize,
    pub max_depth: usize,
    pub max_name_bytes: usize,
}

impl DecodeLimits {
    pub fn from_requested(requested: RequestedLimits) -> Self {
        fn clamp(value: Option<usize>, maximum: usize) -> usize {
            value.unwrap_or(maximum).min(maximum)
        }

        Self {
            max_archive_bytes: clamp(requested.max_archive_bytes, MAX_ARCHIVE_BYTES),
            max_entries: clamp(requested.max_entries, MAX_ENTRIES),
            max_entry_bytes: clamp(requested.max_entry_bytes, MAX_ENTRY_BYTES),
            max_total_bytes: clamp(requested.max_total_bytes, MAX_TOTAL_BYTES),
            max_depth: clamp(requested.max_depth, MAX_DEPTH),
            max_name_bytes: clamp(requested.max_name_bytes, MAX_NAME_BYTES),
        }
    }
}

impl Default for DecodeLimits {
    fn default() -> Self {
        Self::from_requested(RequestedLimits::default())
    }
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct EncodeOptions {
    pub compress: bool,
    #[serde(default)]
    pub compression_assignments: Vec<CompressionAssignment>,
    pub encryption: Option<EncryptionOptions>,
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct EncryptionOptions {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub default_key_index: Option<u32>,
    pub keys: Vec<EncryptionKey>,
    pub assignments: Vec<EncryptionAssignment>,
    pub encrypt_directories: bool,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EncryptionKey {
    pub index: u32,
    pub password: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EncryptionAssignment {
    pub path: String,
    pub key_index: Option<u32>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompressionAssignment {
    pub path: String,
    pub enabled: bool,
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum TarVariant {
    #[default]
    Gnu,
    Pax,
    Ustar,
    V7,
}

#[derive(Clone, Copy, Debug, Default, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct TarOptions {
    pub variant: TarVariant,
}

impl EncodeOptions {
    pub fn passwords(&self) -> Result<HashMap<u32, &str>, String> {
        let mut passwords = HashMap::new();
        if let Some(encryption) = &self.encryption {
            for key in &encryption.keys {
                if key.password.is_empty() {
                    return Err(format!("Password for key index {} is empty", key.index));
                }
                if passwords.insert(key.index, key.password.as_str()).is_some() {
                    return Err(format!("Duplicate password for key index {}", key.index));
                }
            }
        }
        Ok(passwords)
    }
}
