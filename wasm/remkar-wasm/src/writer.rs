use crate::error::{MkarError, MkarErrorCode};
use crate::format::{
    BitWriter, COMPRESSED, FILE_OVERHEAD, IMPLEMENTATION, Mask, PATH_PROP, ROOTDIR,
    STANDARD_VERSION,
};
use crate::model::{
    ArchiveEntry, EncodeOptions, EntryKind, MAX_DEPTH, MAX_ENTRIES, MAX_ENTRY_BYTES,
    MAX_NAME_BYTES, MAX_TOTAL_BYTES, PlannedArchiveEntry,
};
use aes::Aes128;
use cbc::Encryptor;
use cipher::block_padding::Pkcs7;
use cipher::{BlockEncryptMut, KeyIvInit};
use oxiarc_archive::{BrotliWriter, LzhWriter};
use oxiarc_core::Crc16;
use oxiarc_lzhuf::{LzhMethod, encode_lzh as compress_lzh};
use pbkdf2::pbkdf2_hmac;
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, HashMap, HashSet};
use std::io::{Cursor, Write};

const SALT_SIZE: usize = 16;
const IV_SIZE: usize = 16;
const KEY_SIZE: usize = 16;
const PBKDF2_ITERATIONS: u32 = 100_000;

pub fn encode_archive_bytes(
    entries: &[ArchiveEntry],
    options: EncodeOptions,
) -> Result<Vec<u8>, MkarError> {
    let planned = plan_archive_entries(entries, &options)?;
    let mut output = Vec::with_capacity(16);
    output.extend_from_slice(b"MKAR");
    output.extend_from_slice(&IMPLEMENTATION.to_le_bytes());
    output.extend_from_slice(&STANDARD_VERSION.to_le_bytes());
    output.extend_from_slice(&0u64.to_le_bytes());

    let mut file_names = Vec::with_capacity(planned.len());
    let mut file_offsets = Vec::with_capacity(planned.len());

    for (index, entry) in planned.iter().enumerate() {
        let content = entries
            .iter()
            .find(|source| source.path == entry.path && source.kind == EntryKind::File)
            .map(|source| source.content.as_slice())
            .unwrap_or_default();
        let stored = encode_planned_entry(entry, content, &options)?;
        file_names.push(entry.name.as_bytes().to_vec());
        file_offsets.push(output.len());
        output.extend_from_slice(&stored);
        debug_assert_eq!(file_offsets.len(), index + 1);
    }

    let fst_offset = output.len();
    for (name, offset) in file_names.iter().zip(file_offsets) {
        let name_len = u16::try_from(name.len())
            .map_err(|_| MkarError::new(MkarErrorCode::InvalidEntry, "Entry name is too long"))?;
        output.extend_from_slice(&name_len.to_le_bytes());
        output.extend_from_slice(name);
        output.extend_from_slice(&(offset as u64).to_le_bytes());
    }
    output.extend_from_slice(&0x8000u16.to_le_bytes());
    output[8..16].copy_from_slice(&(fst_offset as u64).to_le_bytes());
    Ok(output)
}

pub fn plan_archive_entries(
    entries: &[ArchiveEntry],
    options: &EncodeOptions,
) -> Result<Vec<PlannedArchiveEntry>, MkarError> {
    let mut canonical: BTreeMap<String, (EntryKind, Vec<u8>)> = BTreeMap::new();
    let mut explicit_paths = HashSet::new();
    let mut total_bytes = 0usize;

    for entry in entries {
        let segments = validate_path(&entry.path)?;
        if entry.kind == EntryKind::Folder && !entry.content.is_empty() {
            return Err(invalid_entry(format!(
                "Folder {} cannot contain file bytes",
                entry.path
            )));
        }
        if entry.content.len() > MAX_ENTRY_BYTES {
            return Err(limit_error(format!("Entry {} is too large", entry.path)));
        }
        if entry.kind == EntryKind::File {
            total_bytes = total_bytes
                .checked_add(entry.content.len())
                .ok_or_else(|| limit_error("Total input size overflow"))?;
            if total_bytes > MAX_TOTAL_BYTES {
                return Err(limit_error("Total input size exceeds 256 MiB"));
            }
        }

        let normalized = segments.join("/");
        if !explicit_paths.insert(normalized.clone()) {
            return Err(invalid_entry(format!("Duplicate path: {normalized}")));
        }
        match canonical.get(&normalized) {
            Some((EntryKind::Folder, _)) if entry.kind == EntryKind::Folder => {
                // A child seen earlier may already have synthesized this parent.
            }
            Some(_) => {
                return Err(invalid_entry(format!(
                    "File cannot replace inferred folder: {normalized}"
                )));
            }
            None => {
                canonical.insert(normalized.clone(), (entry.kind, entry.content.clone()));
            }
        }

        for depth in 1..segments.len() {
            let parent = segments[..depth].join("/");
            match canonical.get(&parent) {
                Some((EntryKind::File, _)) => {
                    return Err(invalid_entry(format!("File cannot be a parent: {parent}")));
                }
                Some((EntryKind::Folder, _)) => {}
                None => {
                    canonical.insert(parent, (EntryKind::Folder, Vec::new()));
                }
            }
        }
        if canonical.len() > MAX_ENTRIES {
            return Err(limit_error("Archive has more than 10,000 entries"));
        }
    }

    for path in canonical.keys() {
        let mut current = path.as_str();
        while let Some((parent, _)) = current.rsplit_once('/') {
            if canonical
                .get(parent)
                .is_some_and(|(kind, _)| *kind == EntryKind::File)
            {
                return Err(invalid_entry(format!("File cannot be a parent: {parent}")));
            }
            current = parent;
        }
    }

    let paths: Vec<String> = canonical.keys().cloned().collect();
    let ids: HashMap<String, u32> = paths
        .iter()
        .enumerate()
        .map(|(index, path)| (path.clone(), index as u32))
        .collect();

    let mut children: HashMap<String, Vec<u32>> = HashMap::new();
    for path in &paths {
        if let Some((parent, _)) = path.rsplit_once('/') {
            children
                .entry(parent.to_string())
                .or_default()
                .push(ids[path]);
        }
    }

    let assignments = encryption_assignments(options)?;
    let compression_assignments = compression_assignments(options)?;
    Ok(paths
        .into_iter()
        .map(|path| {
            let (kind, _content) = canonical.remove(&path).expect("planned path must exist");
            let name = path.rsplit('/').next().unwrap_or(&path).to_string();
            let encrypt_directories = options
                .encryption
                .as_ref()
                .is_some_and(|encryption| encryption.enabled && encryption.encrypt_directories);
            PlannedArchiveEntry {
                root: !path.contains('/'),
                children: children.remove(&path).unwrap_or_default(),
                key_index: if kind == EntryKind::Folder && !encrypt_directories {
                    None
                } else if options
                    .encryption
                    .as_ref()
                    .is_some_and(|encryption| encryption.enabled)
                {
                    assigned_key(
                        &path,
                        &assignments,
                        options
                            .encryption
                            .as_ref()
                            .and_then(|encryption| encryption.default_key_index),
                    )
                } else {
                    None
                },
                compressed: compression_enabled(&path, &compression_assignments, options.compress),
                path,
                name,
                kind,
            }
        })
        .collect())
}

pub fn encode_planned_entry(
    entry: &PlannedArchiveEntry,
    content: &[u8],
    options: &EncodeOptions,
) -> Result<Vec<u8>, MkarError> {
    if entry.kind == EntryKind::File && content.len() > MAX_ENTRY_BYTES {
        return Err(limit_error(format!("Entry {} is too large", entry.path)));
    }
    let mut prop = 0u8;
    if entry.root {
        prop |= ROOTDIR;
    }
    if entry.kind == EntryKind::Folder {
        prop |= PATH_PROP;
    }
    let mut payload = match entry.kind {
        EntryKind::File => content.to_vec(),
        EntryKind::Folder => {
            let count = u32::try_from(entry.children.len())
                .map_err(|_| limit_error("Too many directory children"))?;
            let mut bytes = Vec::with_capacity(4 + entry.children.len() * 4);
            bytes.extend_from_slice(&count.to_le_bytes());
            for child in &entry.children {
                bytes.extend_from_slice(&child.to_le_bytes());
            }
            bytes
        }
    };
    if entry.compressed && entry.kind == EntryKind::File && !payload.is_empty() {
        payload = zstd::stream::encode_all(Cursor::new(payload), 11).map_err(|error| {
            invalid_entry(format!("Could not compress {}: {error}", entry.path))
        })?;
        prop |= COMPRESSED;
    }
    if let Some(key_index) = entry.key_index {
        let passwords = options.passwords().map_err(invalid_entry)?;
        let password = passwords
            .get(&key_index)
            .ok_or_else(|| invalid_entry(format!("Missing password for key index {key_index}")))?;
        payload = encrypt_data(&payload, key_index, password)?;
        prop |= crate::format::ENCRYPTED;
    }
    let seed = mask_seed(entry, prop, &payload);
    let mut bit_writer = BitWriter::new();
    bit_writer.write_bits(u16::from(prop), 7)?;
    let mask = Mask::write(&mut bit_writer, seed)?;
    let prefix = bit_writer.finish();
    if prefix.len() != FILE_OVERHEAD {
        return Err(invalid_entry(
            "Internal MKAR entry prefix has an invalid size",
        ));
    }
    for _ in 0..3 {
        mask.mask_bytes(&mut payload);
    }
    let mut stored = Vec::with_capacity(prefix.len() + payload.len());
    stored.extend_from_slice(&prefix);
    stored.extend_from_slice(&payload);
    Ok(stored)
}

fn encryption_assignments(
    options: &EncodeOptions,
) -> Result<Vec<(String, Option<u32>)>, MkarError> {
    let mut assignments = Vec::new();
    let mut seen = HashSet::new();
    if let Some(encryption) = &options.encryption {
        let passwords = options.passwords().map_err(invalid_entry)?;
        for assignment in &encryption.assignments {
            validate_path(&assignment.path)?;
            if !seen.insert(assignment.path.clone()) {
                return Err(invalid_entry(format!(
                    "Duplicate encryption assignment: {}",
                    assignment.path
                )));
            }
            if let Some(key_index) = assignment.key_index
                && !passwords.contains_key(&key_index)
            {
                return Err(invalid_entry(format!(
                    "Missing password for key index {}",
                    key_index
                )));
            }
            assignments.push((assignment.path.clone(), assignment.key_index));
        }
    }
    assignments.sort_by_key(|(path, _)| path.len());
    Ok(assignments)
}

fn assigned_key(
    path: &str,
    assignments: &[(String, Option<u32>)],
    default: Option<u32>,
) -> Option<u32> {
    assignments
        .iter()
        .filter(|(assigned, _)| path == assigned || path.starts_with(&format!("{assigned}/")))
        .max_by_key(|(assigned, _)| assigned.len())
        .map(|(_, key_index)| *key_index)
        .unwrap_or(default)
}

fn compression_assignments(options: &EncodeOptions) -> Result<Vec<(String, bool)>, MkarError> {
    let mut assignments = Vec::new();
    let mut seen = HashSet::new();
    for assignment in &options.compression_assignments {
        validate_path(&assignment.path)?;
        if !seen.insert(assignment.path.clone()) {
            return Err(invalid_entry(format!(
                "Duplicate compression assignment: {}",
                assignment.path
            )));
        }
        assignments.push((assignment.path.clone(), assignment.enabled));
    }
    assignments.sort_by_key(|(path, _)| path.len());
    Ok(assignments)
}

fn compression_enabled(path: &str, assignments: &[(String, bool)], default: bool) -> bool {
    assignments
        .iter()
        .filter(|(assigned, _)| path == assigned || path.starts_with(&format!("{assigned}/")))
        .max_by_key(|(assigned, _)| assigned.len())
        .map(|(_, enabled)| *enabled)
        .unwrap_or(default)
}

fn encrypt_data(data: &[u8], key_index: u32, password: &str) -> Result<Vec<u8>, MkarError> {
    let mut salt = [0u8; SALT_SIZE];
    let mut iv = [0u8; IV_SIZE];
    getrandom::getrandom(&mut salt)
        .map_err(|error| invalid_entry(format!("Could not generate encryption salt: {error}")))?;
    getrandom::getrandom(&mut iv)
        .map_err(|error| invalid_entry(format!("Could not generate encryption IV: {error}")))?;
    let mut key = [0u8; KEY_SIZE];
    pbkdf2_hmac::<Sha256>(password.as_bytes(), &salt, PBKDF2_ITERATIONS, &mut key);
    let encrypted = Encryptor::<Aes128>::new_from_slices(&key, &iv)
        .map_err(|error| invalid_entry(format!("Could not initialize encryption: {error}")))?
        .encrypt_padded_vec_mut::<Pkcs7>(data);
    key.fill(0);
    let mut output = Vec::with_capacity(4 + SALT_SIZE + IV_SIZE + encrypted.len());
    output.extend_from_slice(&key_index.to_le_bytes());
    output.extend_from_slice(&salt);
    output.extend_from_slice(&iv);
    output.extend_from_slice(&encrypted);
    Ok(output)
}

pub fn encode_ar(entries: &[ArchiveEntry]) -> Result<Vec<u8>, MkarError> {
    let files = entries
        .iter()
        .filter(|entry| entry.kind == EntryKind::File)
        .collect::<Vec<_>>();
    if files.is_empty() {
        return Err(invalid_entry(
            "ar archives require at least one file member",
        ));
    }
    let mut builder = ar::Builder::new(Vec::new());
    for entry in files {
        validate_path(&entry.path)?;
        let mut header =
            ar::Header::new(entry.path.as_bytes().to_vec(), entry.content.len() as u64);
        header.set_mtime(0);
        header.set_uid(0);
        header.set_gid(0);
        header.set_mode(0o100644);
        builder
            .append(&header, Cursor::new(&entry.content))
            .map_err(|error| invalid_entry(format!("Could not write ar member: {error}")))?;
    }
    builder
        .into_inner()
        .map_err(|error| invalid_entry(format!("Could not finish ar archive: {error}")))
}

pub fn encode_cab(entries: &[ArchiveEntry]) -> Result<Vec<u8>, MkarError> {
    let files: Vec<(String, Vec<u8>)> = canonical_archive_entries(entries)?
        .into_iter()
        .filter_map(|(path, (kind, data))| (kind == EntryKind::File).then_some((path, data)))
        .collect();
    let mut builder = cab::CabinetBuilder::new();
    {
        let folder = builder.add_folder(cab::CompressionType::MsZip);
        for (path, _) in &files {
            folder.add_file(path.replace('/', "\\"));
        }
    }
    let mut writer = builder
        .build(Cursor::new(Vec::new()))
        .map_err(|error| invalid_entry(format!("Could not create CAB archive: {error}")))?;
    for (_, data) in &files {
        let mut file = writer
            .next_file()
            .map_err(|error| invalid_entry(format!("Could not add CAB file: {error}")))?
            .ok_or_else(|| invalid_entry("CAB writer ended before all files were written"))?;
        file.write_all(data)
            .map_err(|error| invalid_entry(format!("Could not write CAB file: {error}")))?;
    }
    writer
        .finish()
        .map(|cursor| cursor.into_inner())
        .map_err(|error| invalid_entry(format!("Could not finish CAB archive: {error}")))
}

pub fn encode_lzh(entries: &[ArchiveEntry]) -> Result<Vec<u8>, MkarError> {
    let mut writer = LzhWriter::new(Vec::new()).with_header_level(1);
    for (path, (kind, data)) in canonical_archive_entries(entries)? {
        let result = if kind == EntryKind::Folder {
            let directory = format!("{}/", path.trim_end_matches('/'));
            writer.add_file_raw(&directory, LzhMethod::Lh0, 0, 0, &[], 0, None)
        } else {
            let compressed = compress_lzh(&data, LzhMethod::Lh5)
                .map_err(|error| invalid_entry(format!("Could not compress LZH entry: {error}")))?;
            let (method, payload) = if compressed.len() < data.len() {
                (LzhMethod::Lh5, compressed.as_slice())
            } else {
                (LzhMethod::Lh0, data.as_slice())
            };
            writer.add_file_raw(
                &path,
                method,
                Crc16::compute(&data),
                data.len() as u64,
                payload,
                0,
                None,
            )
        };
        result.map_err(|error| invalid_entry(format!("Could not write LZH entry: {error}")))?;
    }
    writer
        .into_inner()
        .map_err(|error| invalid_entry(format!("Could not finish LZH archive: {error}")))
}

pub fn compress_brotli(input: &[u8]) -> Result<Vec<u8>, MkarError> {
    BrotliWriter::new()
        .compress(input)
        .map_err(|error| invalid_entry(format!("Could not compress tar.br: {error}")))
}

fn canonical_archive_entries(
    entries: &[ArchiveEntry],
) -> Result<BTreeMap<String, (EntryKind, Vec<u8>)>, MkarError> {
    let mut canonical = BTreeMap::new();
    for entry in entries {
        let segments = validate_path(&entry.path)?;
        if canonical
            .insert(entry.path.clone(), (entry.kind, entry.content.clone()))
            .is_some()
        {
            return Err(invalid_entry(format!("Duplicate path: {}", entry.path)));
        }
        for depth in 1..segments.len() {
            canonical
                .entry(segments[..depth].join("/"))
                .or_insert((EntryKind::Folder, Vec::new()));
        }
    }
    Ok(canonical)
}

fn validate_path(path: &str) -> Result<Vec<&str>, MkarError> {
    if path.is_empty() || path.starts_with('/') || path.contains('\\') || path.contains('\0') {
        return Err(invalid_entry(format!("Unsafe archive path: {path:?}")));
    }
    let segments: Vec<&str> = path.split('/').collect();
    if segments.len() > MAX_DEPTH {
        return Err(limit_error(format!("Path exceeds {MAX_DEPTH} segments")));
    }
    for segment in &segments {
        if segment.is_empty() || *segment == "." || *segment == ".." {
            return Err(invalid_entry(format!("Unsafe archive path: {path:?}")));
        }
        if segment.len() > MAX_NAME_BYTES {
            return Err(limit_error(format!(
                "Entry name exceeds {MAX_NAME_BYTES} bytes"
            )));
        }
    }
    Ok(segments)
}

fn mask_seed(entry: &PlannedArchiveEntry, prop: u8, payload: &[u8]) -> u64 {
    let mut hasher = Sha256::new();
    hasher.update(entry.path.as_bytes());
    hasher.update([prop]);
    hasher.update((payload.len() as u64).to_le_bytes());
    hasher.update(payload);
    let digest = hasher.finalize();
    u64::from_le_bytes(
        digest[..8]
            .try_into()
            .expect("SHA-256 prefix is eight bytes"),
    )
}

fn invalid_entry(message: impl Into<String>) -> MkarError {
    MkarError::new(MkarErrorCode::InvalidEntry, message)
}

fn limit_error(message: impl Into<String>) -> MkarError {
    MkarError::new(MkarErrorCode::LimitExceeded, message)
}

#[cfg(test)]
mod tests {
    use super::{
        encode_archive_bytes, encode_planned_entry, plan_archive_entries,
    };
    use crate::error::MkarErrorCode;
    use crate::format::FILE_OVERHEAD;
    use crate::model::{
        ArchiveEntry, CompressionAssignment, EncodeOptions, EncryptionAssignment, EncryptionKey,
        EncryptionOptions, EntryKind,
    };
    use crate::reader::{decode_stored_entry, inspect_entry_metadata};

    #[test]
    fn encodes_file_and_empty_folder_as_two_roots() {
        let bytes = encode_archive_bytes(
            &[
                ArchiveEntry::file("hello.txt", b"hello"),
                ArchiveEntry::folder("empty"),
            ],
            EncodeOptions::default(),
        )
        .unwrap();

        assert_eq!(&bytes[0..8], b"MKAR\x09\x20\x02\x00");
        assert_eq!(
            u64::from_le_bytes(bytes[8..16].try_into().unwrap()) as usize,
            16 + 225 + 5 + 225 + 4,
        );
    }

    #[test]
    fn rejects_parent_segments() {
        let error = encode_archive_bytes(
            &[ArchiveEntry::file("../secret", b"x")],
            EncodeOptions::default(),
        )
        .unwrap_err();

        assert_eq!(error.code, MkarErrorCode::InvalidEntry);
    }

    #[test]
    fn accepts_explicit_folder_after_its_child() {
        let child_first = encode_archive_bytes(
            &[
                ArchiveEntry::file("root/hello.txt", b"hello"),
                ArchiveEntry::folder("root"),
            ],
            EncodeOptions::default(),
        )
        .unwrap();
        let parent_first = encode_archive_bytes(
            &[
                ArchiveEntry::folder("root"),
                ArchiveEntry::file("root/hello.txt", b"hello"),
            ],
            EncodeOptions::default(),
        )
        .unwrap();

        assert_eq!(child_first, parent_first);
    }

    #[test]
    fn planned_entries_can_be_encoded_independently() {
        let input = vec![ArchiveEntry::file("root/a.txt", b"hello")];
        let plan = plan_archive_entries(&input, &EncodeOptions::default()).unwrap();
        let file = plan
            .iter()
            .find(|entry| entry.kind == EntryKind::File)
            .unwrap();

        let stored = encode_planned_entry(file, b"hello", &EncodeOptions::default()).unwrap();

        assert_eq!(stored.len(), FILE_OVERHEAD + 5);
    }

    #[test]
    fn encrypts_assigned_subtrees_with_multiple_key_indexes() {
        let options = EncodeOptions {
            compress: false,
            compression_assignments: Vec::new(),
            encryption: Some(EncryptionOptions {
                enabled: true,
                default_key_index: None,
                keys: vec![
                    EncryptionKey {
                        index: 3,
                        password: "first".to_string(),
                    },
                    EncryptionKey {
                        index: 7,
                        password: "second".to_string(),
                    },
                ],
                assignments: vec![
                    EncryptionAssignment {
                        path: "root/secret".to_string(),
                        key_index: Some(7),
                    },
                    EncryptionAssignment {
                        path: "root/other.txt".to_string(),
                        key_index: Some(3),
                    },
                ],
                encrypt_directories: false,
            }),
        };
        let input = vec![
            ArchiveEntry::file("root/public.txt", b"public"),
            ArchiveEntry::file("root/secret/private.txt", b"private"),
            ArchiveEntry::file("root/other.txt", b"other"),
        ];
        let plan = plan_archive_entries(&input, &options).unwrap();
        assert_eq!(
            plan.iter()
                .find(|entry| entry.path == "root/public.txt")
                .unwrap()
                .key_index,
            None
        );
        assert_eq!(
            plan.iter()
                .find(|entry| entry.path == "root/secret")
                .unwrap()
                .key_index,
            None
        );
        let private = plan
            .iter()
            .find(|entry| entry.path == "root/secret/private.txt")
            .unwrap();
        let stored = encode_planned_entry(private, b"private", &options).unwrap();
        let metadata = inspect_entry_metadata(&stored[..FILE_OVERHEAD + 4], 2, 2).unwrap();
        assert_eq!(metadata.key_index, Some(7));

        let required = decode_stored_entry(&stored, 2, Default::default(), 2, None).unwrap_err();
        assert_eq!(required.code, MkarErrorCode::PasswordRequired);
        assert_eq!(required.key_index, Some(7));
        let incorrect =
            decode_stored_entry(&stored, 2, Default::default(), 2, Some("wrong")).unwrap_err();
        assert_eq!(incorrect.code, MkarErrorCode::IncorrectPassword);
        let decoded =
            decode_stored_entry(&stored, 2, Default::default(), 2, Some("second")).unwrap();
        assert_eq!(decoded.content, b"private");

        let mut directory_options = options;
        directory_options
            .encryption
            .as_mut()
            .unwrap()
            .encrypt_directories = true;
        let directory_plan = plan_archive_entries(&input, &directory_options).unwrap();
        assert_eq!(
            directory_plan
                .iter()
                .find(|entry| entry.path == "root/secret")
                .unwrap()
                .key_index,
            Some(7)
        );

        let override_options = EncodeOptions {
            compress: true,
            compression_assignments: vec![CompressionAssignment {
                path: "root/secret".to_string(),
                enabled: false,
            }],
            encryption: Some(EncryptionOptions {
                enabled: true,
                default_key_index: Some(3),
                keys: vec![EncryptionKey {
                    index: 3,
                    password: "first".to_string(),
                }],
                assignments: vec![EncryptionAssignment {
                    path: "root/secret/private.txt".to_string(),
                    key_index: None,
                }],
                encrypt_directories: false,
            }),
        };
        let override_plan = plan_archive_entries(&input, &override_options).unwrap();
        assert_eq!(
            override_plan
                .iter()
                .find(|entry| entry.path == "root/public.txt")
                .unwrap()
                .key_index,
            Some(3)
        );
        assert_eq!(
            override_plan
                .iter()
                .find(|entry| entry.path == "root/secret/private.txt")
                .unwrap()
                .key_index,
            None
        );
        assert!(
            override_plan
                .iter()
                .find(|entry| entry.path == "root/public.txt")
                .unwrap()
                .compressed
        );
        assert!(
            !override_plan
                .iter()
                .find(|entry| entry.path == "root/secret/private.txt")
                .unwrap()
                .compressed
        );
    }
}
