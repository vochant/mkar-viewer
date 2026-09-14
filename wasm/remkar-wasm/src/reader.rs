use crate::error::{MkarError, MkarErrorCode};
use crate::format::{
    BitReader, COMPRESSED, ENCRYPTED, FILE_OVERHEAD, IMPLEMENTATION, Mask, NETWORK, PATH_PROP,
    ROOTDIR, SCRIPT, STANDARD_VERSION, SYMLINK,
};
use crate::model::{
    ArchiveEntry, DecodeLimits, DecodedStoredEntry, EntryKind, EntryMetadata, EntryPrefix,
    ManifestEntry, ManifestInput,
};
use aes::Aes128;
use cbc::Decryptor;
use cipher::block_padding::Pkcs7;
use cipher::{BlockDecryptMut, KeyIvInit};
use pbkdf2::pbkdf2_hmac;
use sha2::Sha256;
use std::collections::HashSet;
use std::io::{Cursor, Read};

const SALT_SIZE: usize = 16;
const IV_SIZE: usize = 16;
const KEY_SIZE: usize = 16;
const PBKDF2_ITERATIONS: u32 = 100_000;

#[derive(Debug)]
struct ParsedEntry {
    name: String,
    prop: u8,
    data: Vec<u8>,
}

pub fn decode_archive_bytes(
    bytes: &[u8],
    limits: DecodeLimits,
) -> Result<Vec<ArchiveEntry>, MkarError> {
    if bytes.len() > limits.max_archive_bytes {
        return Err(limit_error(format!(
            "Archive exceeds the {} byte input limit",
            limits.max_archive_bytes
        )));
    }
    if bytes.len() < 16 {
        return Err(invalid_archive("Archive header is shorter than 16 bytes"));
    }
    if &bytes[..4] != b"MKAR" {
        return Err(invalid_archive("Invalid MKAR signature"));
    }

    let implementation = read_u16(bytes, 4)?;
    if implementation != IMPLEMENTATION {
        return Err(invalid_archive(format!(
            "Unsupported MKAR implementation: {implementation:#06x}"
        )));
    }
    let version = read_u16(bytes, 6)?;
    if version > STANDARD_VERSION {
        return Err(MkarError::new(
            MkarErrorCode::UnsupportedVersion,
            format!("MKAR version {version} is newer than supported version {STANDARD_VERSION}"),
        ));
    }
    let fst_offset = usize::try_from(read_u64(bytes, 8)?)
        .map_err(|_| invalid_archive("FST offset does not fit browser memory"))?;
    if fst_offset < 16 || fst_offset > bytes.len() {
        return Err(invalid_archive("FST offset is outside the archive payload"));
    }

    let (names, offsets) = parse_fst(bytes, fst_offset, limits)?;
    let mut parsed = Vec::with_capacity(names.len());
    for (index, name) in names.into_iter().enumerate() {
        let start = offsets[index];
        let end = offsets.get(index + 1).copied().unwrap_or(fst_offset);
        let stored = bytes
            .get(start..end)
            .ok_or_else(|| invalid_archive("Entry range is outside the archive"))?;
        parsed.push(parse_entry(
            stored,
            name,
            version,
            limits,
            index as u32,
            None,
        )?);
    }

    if parsed.is_empty() {
        return Ok(Vec::new());
    }
    let roots: Vec<usize> = parsed
        .iter()
        .enumerate()
        .filter_map(|(index, entry)| (entry.prop & ROOTDIR != 0).then_some(index))
        .collect();
    if roots.is_empty() {
        return Err(invalid_archive("Archive has entries but no root entries"));
    }

    let mut state = FlattenState {
        limits,
        output: Vec::with_capacity(parsed.len()),
        reachable: vec![false; parsed.len()],
        stack: Vec::new(),
        paths: HashSet::new(),
        total_file_bytes: 0,
    };
    for root in roots {
        let path = parsed[root].name.clone();
        flatten_entry(root, path, &parsed, &mut state)?;
    }
    if let Some(unreachable) = state.reachable.iter().position(|seen| !seen) {
        return Err(invalid_archive(format!(
            "Archive entry {unreachable} is not reachable from a root"
        ))
        .with_entry(unreachable as u32));
    }
    Ok(state.output)
}

fn parse_fst(
    bytes: &[u8],
    fst_offset: usize,
    limits: DecodeLimits,
) -> Result<(Vec<String>, Vec<usize>), MkarError> {
    let mut cursor = fst_offset;
    let mut names = Vec::new();
    let mut offsets = Vec::new();

    loop {
        let name_len = read_u16(bytes, cursor)? as usize;
        cursor = cursor
            .checked_add(2)
            .ok_or_else(|| invalid_archive("FST cursor overflow"))?;
        if name_len == 0x8000 {
            break;
        }
        if names.len() >= limits.max_entries {
            return Err(limit_error(format!(
                "Archive exceeds the {} entry limit",
                limits.max_entries
            )));
        }
        if name_len == 0 || name_len > limits.max_name_bytes {
            return Err(limit_error(format!(
                "Entry name length {name_len} is outside the configured limit"
            )));
        }
        let name_end = cursor
            .checked_add(name_len)
            .ok_or_else(|| invalid_archive("FST name length overflow"))?;
        let name_bytes = bytes
            .get(cursor..name_end)
            .ok_or_else(|| invalid_archive("FST entry name extends past archive end"))?;
        let name = std::str::from_utf8(name_bytes)
            .map_err(|_| invalid_archive("FST entry name is not valid UTF-8"))?
            .to_string();
        validate_name(&name, limits.max_name_bytes)?;
        cursor = name_end;
        let offset = usize::try_from(read_u64(bytes, cursor)?)
            .map_err(|_| invalid_archive("Entry offset does not fit browser memory"))?;
        cursor = cursor
            .checked_add(8)
            .ok_or_else(|| invalid_archive("FST cursor overflow"))?;
        if offset < 16 || offset >= fst_offset {
            return Err(invalid_archive(format!(
                "Entry offset {offset} is outside the payload region"
            )));
        }
        if offsets.last().is_some_and(|previous| offset <= *previous) {
            return Err(invalid_archive("Entry offsets must be strictly increasing"));
        }
        names.push(name);
        offsets.push(offset);
    }

    if cursor != bytes.len() {
        return Err(invalid_archive("Unexpected bytes after FST terminator"));
    }
    if offsets.first().is_some_and(|offset| *offset != 16) {
        return Err(invalid_archive(
            "First archive entry must start after the header",
        ));
    }
    for index in 0..offsets.len() {
        let end = offsets.get(index + 1).copied().unwrap_or(fst_offset);
        let stored = end
            .checked_sub(offsets[index])
            .ok_or_else(|| invalid_archive("Entry offset underflow"))?;
        if stored < FILE_OVERHEAD {
            return Err(invalid_archive(format!(
                "Entry {index} is shorter than its format prefix"
            ))
            .with_entry(index as u32));
        }
    }
    Ok((names, offsets))
}

fn parse_entry(
    stored: &[u8],
    name: String,
    version: u16,
    limits: DecodeLimits,
    index: u32,
    password: Option<&str>,
) -> Result<ParsedEntry, MkarError> {
    let mut bit_reader = BitReader::new(stored);
    let prop = bit_reader.read_bits(7)? as u8;
    let mask = Mask::read(&mut bit_reader, version)?;
    if bit_reader.bytes_consumed() != FILE_OVERHEAD {
        return Err(invalid_archive("Entry prefix has an invalid size").with_entry(index));
    }
    validate_entry_features(prop, index)?;

    let mut data = stored[FILE_OVERHEAD..].to_vec();
    for _ in 0..3 {
        mask.unmask_bytes(&mut data);
    }
    if prop & ENCRYPTED != 0 {
        let key_index = data
            .get(..4)
            .and_then(|value| value.try_into().ok())
            .map(u32::from_le_bytes)
            .unwrap_or(0);
        data = decrypt_data(&data, password, key_index, index)?;
    }
    if prop & COMPRESSED != 0 {
        data = decompress_bounded(&data, limits.max_entry_bytes, index)?;
    } else if data.len() > limits.max_entry_bytes {
        return Err(limit_error(format!(
            "Entry {index} exceeds the {} byte decoded limit",
            limits.max_entry_bytes
        ))
        .with_entry(index));
    }
    Ok(ParsedEntry { name, prop, data })
}

pub fn inspect_entry_prefix(
    prefix: &[u8],
    version: u16,
    index: u32,
) -> Result<EntryPrefix, MkarError> {
    if version > STANDARD_VERSION {
        return Err(MkarError::new(
            MkarErrorCode::UnsupportedVersion,
            format!("MKAR version {version} is newer than supported version {STANDARD_VERSION}"),
        ));
    }
    if prefix.len() != FILE_OVERHEAD {
        return Err(invalid_archive(format!(
            "Entry {index} prefix must be {FILE_OVERHEAD} bytes"
        ))
        .with_entry(index));
    }
    let mut reader = BitReader::new(prefix);
    let prop = reader.read_bits(7)? as u8;
    Mask::read(&mut reader, version)?;
    validate_entry_features(prop, index)?;
    Ok(EntryPrefix { prop })
}

pub fn inspect_entry_metadata(
    stored_prefix: &[u8],
    version: u16,
    index: u32,
) -> Result<EntryMetadata, MkarError> {
    if stored_prefix.len() < FILE_OVERHEAD {
        return Err(invalid_archive(format!(
            "Entry {index} metadata is shorter than {FILE_OVERHEAD} bytes"
        ))
        .with_entry(index));
    }
    let mut reader = BitReader::new(&stored_prefix[..FILE_OVERHEAD]);
    let prop = reader.read_bits(7)? as u8;
    let mask = Mask::read(&mut reader, version)?;
    validate_entry_features(prop, index)?;
    let key_index = if prop & ENCRYPTED != 0 {
        let encrypted_prefix = stored_prefix
            .get(FILE_OVERHEAD..FILE_OVERHEAD + 4)
            .ok_or_else(|| invalid_archive("Encrypted entry key index is truncated"))?;
        let mut key_bytes = encrypted_prefix.to_vec();
        for _ in 0..3 {
            mask.unmask_bytes(&mut key_bytes);
        }
        Some(u32::from_le_bytes(key_bytes.try_into().map_err(|_| {
            invalid_archive("Encrypted key index is invalid")
        })?))
    } else {
        None
    };
    Ok(EntryMetadata { prop, key_index })
}

pub fn inspect_entry_prop(stored_prefix: &[u8], index: u32) -> Result<EntryPrefix, MkarError> {
    let first = *stored_prefix
        .first()
        .ok_or_else(|| invalid_archive(format!("Entry {index} prefix is empty")))?;
    let prop = first >> 1;
    validate_entry_features(prop, index)?;
    Ok(EntryPrefix { prop })
}

pub fn decode_stored_entry(
    stored: &[u8],
    version: u16,
    limits: DecodeLimits,
    index: u32,
    password: Option<&str>,
) -> Result<DecodedStoredEntry, MkarError> {
    let parsed = parse_entry(stored, String::new(), version, limits, index, password)?;
    Ok(DecodedStoredEntry {
        prop: parsed.prop,
        content: parsed.data,
    })
}

fn decrypt_data(
    data: &[u8],
    password: Option<&str>,
    key_index: u32,
    index: u32,
) -> Result<Vec<u8>, MkarError> {
    let password = password.ok_or_else(|| MkarError::password_required(key_index, index))?;
    if data.len() < 4 + SALT_SIZE + IV_SIZE + 16 {
        return Err(invalid_archive("Encrypted payload is too short").with_entry(index));
    }
    let salt = &data[4..4 + SALT_SIZE];
    let iv = &data[4 + SALT_SIZE..4 + SALT_SIZE + IV_SIZE];
    let cipher_data = &data[4 + SALT_SIZE + IV_SIZE..];
    let mut key = [0u8; KEY_SIZE];
    pbkdf2_hmac::<Sha256>(password.as_bytes(), salt, PBKDF2_ITERATIONS, &mut key);
    let result = Decryptor::<Aes128>::new_from_slices(&key, iv)
        .map_err(|_| invalid_archive("Encrypted payload has invalid parameters"))?
        .decrypt_padded_vec_mut::<Pkcs7>(cipher_data)
        .map_err(|_| {
            MkarError::new(
                MkarErrorCode::IncorrectPassword,
                format!("Password for key index {key_index} is incorrect"),
            )
            .with_entry(index)
            .with_key_index(key_index)
        });
    key.fill(0);
    result
}

fn validate_entry_features(prop: u8, index: u32) -> Result<(), MkarError> {
    if prop & NETWORK != 0 {
        return Err(MkarError::new(
            MkarErrorCode::UnsupportedFeature,
            "Network archive entries are disabled in the browser",
        )
        .with_entry(index));
    }
    if prop & SCRIPT != 0 {
        return Err(MkarError::new(
            MkarErrorCode::UnsupportedFeature,
            "Executable archive entries are disabled in the browser",
        )
        .with_entry(index));
    }
    Ok(())
}

pub fn build_manifest(
    inputs: Vec<ManifestInput>,
    limits: DecodeLimits,
) -> Result<Vec<ManifestEntry>, MkarError> {
    if inputs.len() > limits.max_entries {
        return Err(limit_error(format!(
            "Archive exceeds the {} entry limit",
            limits.max_entries
        )));
    }
    if inputs.is_empty() {
        return Ok(Vec::new());
    }
    for (index, entry) in inputs.iter().enumerate() {
        validate_name(&entry.name, limits.max_name_bytes)?;
        validate_entry_features(entry.prop, index as u32)?;
        if entry.source_index as usize >= inputs.len() {
            return Err(invalid_archive("Manifest source index is out of range"));
        }
    }
    let roots = inputs
        .iter()
        .enumerate()
        .filter_map(|(index, entry)| (entry.prop & ROOTDIR != 0).then_some(index))
        .collect::<Vec<_>>();
    if roots.is_empty() {
        return Err(invalid_archive("Archive has entries but no root entries"));
    }
    let mut state = ManifestState {
        limits,
        output: Vec::with_capacity(inputs.len()),
        reachable: vec![false; inputs.len()],
        stack: Vec::new(),
        paths: HashSet::new(),
    };
    for root in roots {
        flatten_manifest(root, inputs[root].name.clone(), &inputs, &mut state)?;
    }
    let has_opaque_directory = inputs
        .iter()
        .any(|entry| entry.prop & PATH_PROP != 0 && (entry.locked || !entry.loaded));
    if !has_opaque_directory
        && let Some(unreachable) = state.reachable.iter().position(|seen| !seen)
    {
        return Err(invalid_archive(format!(
            "Archive entry {unreachable} is not reachable from a root"
        ))
        .with_entry(unreachable as u32));
    }
    Ok(state.output)
}

struct ManifestState {
    limits: DecodeLimits,
    output: Vec<ManifestEntry>,
    reachable: Vec<bool>,
    stack: Vec<usize>,
    paths: HashSet<String>,
}

fn flatten_manifest(
    fsid: usize,
    path: String,
    entries: &[ManifestInput],
    state: &mut ManifestState,
) -> Result<(), MkarError> {
    if state.stack.len() >= state.limits.max_depth {
        return Err(limit_error(format!(
            "Archive graph exceeds depth {}",
            state.limits.max_depth
        ))
        .with_entry(fsid as u32));
    }
    if state.stack.contains(&fsid) {
        return Err(
            invalid_archive(format!("Archive graph contains a cycle at entry {fsid}"))
                .with_entry(fsid as u32),
        );
    }
    let entry = entries
        .get(fsid)
        .ok_or_else(|| invalid_archive(format!("Entry ID {fsid} is out of range")))?;
    state.reachable[fsid] = true;
    state.stack.push(fsid);
    let result = if entry.locked {
        insert_manifest_path(&path, state)?;
        state.output.push(ManifestEntry {
            path,
            kind: if entry.prop & PATH_PROP != 0 {
                EntryKind::Folder
            } else {
                EntryKind::File
            },
            source_index: entry.source_index,
            size: entry.stored_size,
            encrypted: entry.prop & ENCRYPTED != 0,
            locked: true,
            key_index: entry.key_index,
        });
        Ok(())
    } else if entry.prop & SYMLINK != 0 {
        if entry.data.len() != 4 {
            Err(
                invalid_archive(format!("Symlink entry {fsid} must contain one FSID"))
                    .with_entry(fsid as u32),
            )
        } else {
            let target =
                u32::from_le_bytes(entry.data[..4].try_into().map_err(|_| {
                    invalid_archive(format!("Symlink entry {fsid} has invalid data"))
                })?) as usize;
            flatten_manifest(target, path, entries, state)
        }
    } else if entry.prop & PATH_PROP != 0 {
        insert_manifest_path(&path, state)?;
        state.output.push(ManifestEntry {
            path: path.clone(),
            kind: EntryKind::Folder,
            source_index: entry.source_index,
            size: 0,
            encrypted: entry.prop & ENCRYPTED != 0,
            locked: entry.locked,
            key_index: entry.key_index,
        });
        if !entry.loaded {
            state.stack.pop();
            return Ok(());
        }
        let children = directory_children(&entry.data, fsid)?;
        let mut child_names = HashSet::new();
        for child in children {
            let child_entry = entries.get(child).ok_or_else(|| {
                invalid_archive(format!("Directory child {child} is out of range"))
            })?;
            if !child_names.insert(child_entry.name.as_str()) {
                return Err(invalid_archive(format!(
                    "Directory entry {fsid} contains duplicate child name {}",
                    child_entry.name
                ))
                .with_entry(fsid as u32));
            }
            flatten_manifest(
                child,
                format!("{path}/{}", child_entry.name),
                entries,
                state,
            )?;
        }
        Ok(())
    } else {
        insert_manifest_path(&path, state)?;
        state.output.push(ManifestEntry {
            path,
            kind: EntryKind::File,
            source_index: entry.source_index,
            size: entry.stored_size,
            encrypted: entry.prop & ENCRYPTED != 0,
            locked: entry.locked,
            key_index: entry.key_index,
        });
        Ok(())
    };
    state.stack.pop();
    result
}

fn directory_children(data: &[u8], fsid: usize) -> Result<Vec<usize>, MkarError> {
    if data.len() < 4 {
        return Err(
            invalid_archive(format!("Directory entry {fsid} is too short")).with_entry(fsid as u32),
        );
    }
    let count = u32::from_le_bytes(
        data[..4]
            .try_into()
            .map_err(|_| invalid_archive("Directory child count is truncated"))?,
    ) as usize;
    let expected = count
        .checked_mul(4)
        .and_then(|size| size.checked_add(4))
        .ok_or_else(|| invalid_archive("Directory child count overflow"))?;
    if data.len() != expected {
        return Err(invalid_archive(format!(
            "Directory entry {fsid} child table has the wrong size"
        ))
        .with_entry(fsid as u32));
    }
    (0..count)
        .map(|position| {
            let offset = 4 + position * 4;
            data[offset..offset + 4]
                .try_into()
                .map(u32::from_le_bytes)
                .map(|child| child as usize)
                .map_err(|_| invalid_archive("Directory child ID is truncated"))
        })
        .collect()
}

fn insert_manifest_path(path: &str, state: &mut ManifestState) -> Result<(), MkarError> {
    if !state.paths.insert(path.to_string()) {
        return Err(invalid_archive(format!(
            "Archive contains duplicate path {path}"
        )));
    }
    Ok(())
}

fn decompress_bounded(data: &[u8], maximum: usize, index: u32) -> Result<Vec<u8>, MkarError> {
    let decoder = zstd::stream::read::Decoder::new(Cursor::new(data)).map_err(|error| {
        invalid_archive(format!("Entry {index} has invalid zstd data: {error}")).with_entry(index)
    })?;
    let take_limit = u64::try_from(maximum)
        .unwrap_or(u64::MAX - 1)
        .saturating_add(1);
    let mut output = Vec::new();
    decoder
        .take(take_limit)
        .read_to_end(&mut output)
        .map_err(|error| {
            invalid_archive(format!("Entry {index} zstd decode failed: {error}")).with_entry(index)
        })?;
    if output.len() > maximum {
        return Err(limit_error(format!(
            "Entry {index} exceeds the {maximum} byte decoded limit"
        ))
        .with_entry(index));
    }
    Ok(output)
}

struct FlattenState {
    limits: DecodeLimits,
    output: Vec<ArchiveEntry>,
    reachable: Vec<bool>,
    stack: Vec<usize>,
    paths: HashSet<String>,
    total_file_bytes: usize,
}

fn flatten_entry(
    fsid: usize,
    path: String,
    entries: &[ParsedEntry],
    state: &mut FlattenState,
) -> Result<(), MkarError> {
    if state.stack.len() >= state.limits.max_depth {
        return Err(limit_error(format!(
            "Archive graph exceeds depth {}",
            state.limits.max_depth
        ))
        .with_entry(fsid as u32));
    }
    if state.stack.contains(&fsid) {
        return Err(
            invalid_archive(format!("Archive graph contains a cycle at entry {fsid}"))
                .with_entry(fsid as u32),
        );
    }
    let entry = entries
        .get(fsid)
        .ok_or_else(|| invalid_archive(format!("Entry ID {fsid} is out of range")))?;
    state.reachable[fsid] = true;
    state.stack.push(fsid);

    let result = if entry.prop & SYMLINK != 0 {
        if entry.data.len() != 4 {
            Err(
                invalid_archive(format!("Symlink entry {fsid} must contain one FSID"))
                    .with_entry(fsid as u32),
            )
        } else {
            let target =
                u32::from_le_bytes(entry.data[..4].try_into().map_err(|_| {
                    invalid_archive(format!("Symlink entry {fsid} has invalid data"))
                })?) as usize;
            flatten_entry(target, path, entries, state)
        }
    } else if entry.prop & PATH_PROP != 0 {
        flatten_directory(fsid, path, entry, entries, state)
    } else {
        insert_path(&path, state)?;
        state.total_file_bytes = state
            .total_file_bytes
            .checked_add(entry.data.len())
            .ok_or_else(|| limit_error("Total decoded size overflow"))?;
        if state.total_file_bytes > state.limits.max_total_bytes {
            Err(limit_error(format!(
                "Decoded files exceed the {} byte total limit",
                state.limits.max_total_bytes
            ))
            .with_entry(fsid as u32))
        } else {
            state.output.push(ArchiveEntry::file(path, &entry.data));
            Ok(())
        }
    };

    state.stack.pop();
    result
}

fn flatten_directory(
    fsid: usize,
    path: String,
    entry: &ParsedEntry,
    entries: &[ParsedEntry],
    state: &mut FlattenState,
) -> Result<(), MkarError> {
    if entry.data.len() < 4 {
        return Err(
            invalid_archive(format!("Directory entry {fsid} is too short")).with_entry(fsid as u32),
        );
    }
    let count = u32::from_le_bytes(
        entry.data[..4]
            .try_into()
            .map_err(|_| invalid_archive(format!("Directory entry {fsid} has invalid data")))?,
    ) as usize;
    let expected = count
        .checked_mul(4)
        .and_then(|size| size.checked_add(4))
        .ok_or_else(|| invalid_archive("Directory child count overflow"))?;
    if entry.data.len() != expected {
        return Err(invalid_archive(format!(
            "Directory entry {fsid} child table has the wrong size"
        ))
        .with_entry(fsid as u32));
    }

    insert_path(&path, state)?;
    state.output.push(ArchiveEntry::folder(path.clone()));
    let mut child_names = HashSet::new();
    for position in 0..count {
        let offset = 4 + position * 4;
        let child = u32::from_le_bytes(
            entry.data[offset..offset + 4]
                .try_into()
                .map_err(|_| invalid_archive("Directory child ID is truncated"))?,
        ) as usize;
        let child_entry = entries
            .get(child)
            .ok_or_else(|| invalid_archive(format!("Directory child {child} is out of range")))?;
        validate_name(&child_entry.name, state.limits.max_name_bytes)?;
        if !child_names.insert(child_entry.name.as_str()) {
            return Err(invalid_archive(format!(
                "Directory entry {fsid} contains duplicate child name {}",
                child_entry.name
            ))
            .with_entry(fsid as u32));
        }
        flatten_entry(
            child,
            format!("{path}/{}", child_entry.name),
            entries,
            state,
        )?;
    }
    Ok(())
}

fn insert_path(path: &str, state: &mut FlattenState) -> Result<(), MkarError> {
    if !state.paths.insert(path.to_string()) {
        return Err(invalid_archive(format!(
            "Archive contains duplicate path {path}"
        )));
    }
    Ok(())
}

fn validate_name(name: &str, max_name_bytes: usize) -> Result<(), MkarError> {
    if name.is_empty()
        || name.len() > max_name_bytes
        || name == "."
        || name == ".."
        || name.contains('/')
        || name.contains('\\')
        || name.contains('\0')
    {
        return Err(invalid_archive(format!(
            "Unsafe archive entry name: {name:?}"
        )));
    }
    Ok(())
}

fn read_u16(bytes: &[u8], offset: usize) -> Result<u16, MkarError> {
    let value: [u8; 2] = bytes
        .get(offset..offset.saturating_add(2))
        .ok_or_else(|| invalid_archive("Unexpected end of archive"))?
        .try_into()
        .map_err(|_| invalid_archive("Invalid two-byte integer"))?;
    Ok(u16::from_le_bytes(value))
}

fn read_u64(bytes: &[u8], offset: usize) -> Result<u64, MkarError> {
    let value: [u8; 8] = bytes
        .get(offset..offset.saturating_add(8))
        .ok_or_else(|| invalid_archive("Unexpected end of archive"))?
        .try_into()
        .map_err(|_| invalid_archive("Invalid eight-byte integer"))?;
    Ok(u64::from_le_bytes(value))
}

fn invalid_archive(message: impl Into<String>) -> MkarError {
    MkarError::new(MkarErrorCode::InvalidArchive, message)
}

fn limit_error(message: impl Into<String>) -> MkarError {
    MkarError::new(MkarErrorCode::LimitExceeded, message)
}

#[cfg(test)]
mod tests {
    use super::{
        build_manifest, decode_archive_bytes, decode_stored_entry, inspect_entry_prefix, parse_fst,
    };
    use crate::error::MkarErrorCode;
    use crate::format::{BitWriter, ENCRYPTED, FILE_OVERHEAD, Mask, PATH_PROP, ROOTDIR};
    use crate::model::{ArchiveEntry, DecodeLimits, EncodeOptions, ManifestInput};
    use crate::writer::encode_archive_bytes;

    fn raw_archive(entries: &[(&str, u8, Vec<u8>)]) -> Vec<u8> {
        let mut bytes = b"MKAR\x09\x20\x02\x00".to_vec();
        bytes.extend_from_slice(&0u64.to_le_bytes());
        let mut offsets = Vec::new();

        for (index, (_, prop, raw_payload)) in entries.iter().enumerate() {
            offsets.push(bytes.len());
            let mut prefix = BitWriter::new();
            prefix.write_bits(u16::from(*prop), 7).unwrap();
            let mask = Mask::write(&mut prefix, index as u64 + 1).unwrap();
            bytes.extend_from_slice(&prefix.finish());

            let mut payload = raw_payload.clone();
            for _ in 0..3 {
                mask.mask_bytes(&mut payload);
            }
            bytes.extend_from_slice(&payload);
        }

        let fst_offset = bytes.len();
        for ((name, _, _), offset) in entries.iter().zip(offsets) {
            bytes.extend_from_slice(&(name.len() as u16).to_le_bytes());
            bytes.extend_from_slice(name.as_bytes());
            bytes.extend_from_slice(&(offset as u64).to_le_bytes());
        }
        bytes.extend_from_slice(&0x8000u16.to_le_bytes());
        bytes[8..16].copy_from_slice(&(fst_offset as u64).to_le_bytes());
        bytes
    }

    #[test]
    fn rejects_fst_before_header() {
        let mut bytes = b"MKAR\x09\x20\x02\x00".to_vec();
        bytes.extend_from_slice(&8u64.to_le_bytes());

        let error = decode_archive_bytes(&bytes, DecodeLimits::default()).unwrap_err();

        assert_eq!(error.code, MkarErrorCode::InvalidArchive);
    }

    #[test]
    fn round_trip_preserves_nested_and_empty_entries() {
        let input = vec![
            ArchiveEntry::folder("root"),
            ArchiveEntry::folder("root/empty"),
            ArchiveEntry::file("root/hello.txt", b"hello"),
        ];
        let bytes = encode_archive_bytes(&input, EncodeOptions::default()).unwrap();

        assert_eq!(
            decode_archive_bytes(&bytes, DecodeLimits::default()).unwrap(),
            input,
        );
    }

    #[test]
    fn compressed_round_trip_is_bounded_and_lossless() {
        let input = vec![ArchiveEntry::file("hello.txt", b"hello hello hello")];
        let bytes = encode_archive_bytes(
            &input,
            EncodeOptions {
                compress: true,
                ..EncodeOptions::default()
            },
        )
        .unwrap();

        assert_eq!(
            decode_archive_bytes(&bytes, DecodeLimits::default()).unwrap(),
            input,
        );

        let error = decode_archive_bytes(
            &bytes,
            DecodeLimits {
                max_entry_bytes: 4,
                ..DecodeLimits::default()
            },
        )
        .unwrap_err();
        assert_eq!(error.code, MkarErrorCode::LimitExceeded);
    }

    #[test]
    fn enforces_aggregate_decoded_limit() {
        let bytes = encode_archive_bytes(
            &[
                ArchiveEntry::file("a", b"123"),
                ArchiveEntry::file("b", b"456"),
            ],
            EncodeOptions::default(),
        )
        .unwrap();

        let error = decode_archive_bytes(
            &bytes,
            DecodeLimits {
                max_total_bytes: 5,
                ..DecodeLimits::default()
            },
        )
        .unwrap_err();

        assert_eq!(error.code, MkarErrorCode::LimitExceeded);
    }

    #[test]
    fn reports_encrypted_entry_key_without_attempting_decryption() {
        let bytes = raw_archive(&[("secret", ROOTDIR | ENCRYPTED, 7u32.to_le_bytes().to_vec())]);

        let error = decode_archive_bytes(&bytes, DecodeLimits::default()).unwrap_err();

        assert_eq!(error.code, MkarErrorCode::PasswordRequired);
        assert_eq!(error.entry, Some(0));
        assert_eq!(error.key_index, Some(7));
    }

    #[test]
    fn rejects_cycles_in_directory_graph() {
        let mut root_children = 1u32.to_le_bytes().to_vec();
        root_children.extend_from_slice(&1u32.to_le_bytes());
        let mut child_children = 1u32.to_le_bytes().to_vec();
        child_children.extend_from_slice(&0u32.to_le_bytes());
        let bytes = raw_archive(&[
            ("root", ROOTDIR | PATH_PROP, root_children),
            ("child", PATH_PROP, child_children),
        ]);

        let error = decode_archive_bytes(&bytes, DecodeLimits::default()).unwrap_err();

        assert_eq!(error.code, MkarErrorCode::InvalidArchive);
        assert!(error.message.contains("cycle"));
    }

    #[test]
    fn manifest_keeps_file_payload_out_of_memory() {
        let bytes = encode_archive_bytes(
            &[ArchiveEntry::file("root/large.bin", vec![7; 1024])],
            EncodeOptions::default(),
        )
        .unwrap();
        let fst_offset = u64::from_le_bytes(bytes[8..16].try_into().unwrap()) as usize;
        let (names, offsets) = parse_fst(&bytes, fst_offset, DecodeLimits::default()).unwrap();
        let entries = names
            .into_iter()
            .enumerate()
            .map(|(index, name)| {
                let start = offsets[index];
                let end = offsets.get(index + 1).copied().unwrap_or(fst_offset);
                let prefix =
                    inspect_entry_prefix(&bytes[start..start + FILE_OVERHEAD], 2, index as u32)
                        .unwrap();
                ManifestInput {
                    name,
                    prop: prefix.prop,
                    source_index: index as u32,
                    stored_size: end - start - FILE_OVERHEAD,
                    locked: false,
                    loaded: true,
                    key_index: None,
                    data: if prefix.prop & PATH_PROP != 0 {
                        decode_stored_entry(
                            &bytes[start..end],
                            2,
                            DecodeLimits::default(),
                            index as u32,
                            None,
                        )
                        .unwrap()
                        .content
                    } else {
                        Vec::new()
                    },
                }
            })
            .collect::<Vec<_>>();

        let manifest = build_manifest(entries, DecodeLimits::default()).unwrap();

        assert_eq!(manifest.last().unwrap().path, "root/large.bin");
        assert_eq!(manifest.last().unwrap().source_index, 1);
        assert_eq!(manifest.last().unwrap().size, 1024);
    }

    #[test]
    fn manifest_stops_at_unloaded_directories() {
        let child_table = |child: u32| {
            let mut data = 1u32.to_le_bytes().to_vec();
            data.extend_from_slice(&child.to_le_bytes());
            data
        };
        let mut entries = vec![
            ManifestInput {
                name: "root".to_string(),
                prop: ROOTDIR | PATH_PROP,
                source_index: 0,
                stored_size: 8,
                locked: false,
                loaded: true,
                key_index: None,
                data: child_table(1),
            },
            ManifestInput {
                name: "nested".to_string(),
                prop: PATH_PROP,
                source_index: 1,
                stored_size: 8,
                locked: false,
                loaded: false,
                key_index: None,
                data: Vec::new(),
            },
            ManifestInput {
                name: "deep.txt".to_string(),
                prop: 0,
                source_index: 2,
                stored_size: 1,
                locked: false,
                loaded: false,
                key_index: None,
                data: Vec::new(),
            },
        ];

        let shallow = build_manifest(entries.clone(), DecodeLimits::default()).unwrap();
        assert_eq!(
            shallow
                .iter()
                .map(|entry| entry.path.as_str())
                .collect::<Vec<_>>(),
            vec!["root", "root/nested"]
        );

        entries[1].loaded = true;
        entries[1].data = child_table(2);
        let deep = build_manifest(entries, DecodeLimits::default()).unwrap();
        assert_eq!(deep.last().unwrap().path, "root/nested/deep.txt");
    }
}
