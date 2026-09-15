use crate::{
    error::{MkarError, MkarErrorCode},
    model::{ArchiveEntry, EncodeOptions, EntryKind},
    writer::plan_archive_entries,
};
use asar::AsarWriter;

pub fn encode_asar(entries: &[ArchiveEntry]) -> Result<Vec<u8>, MkarError> {
    plan_archive_entries(entries, &EncodeOptions::default())?;
    let mut writer = AsarWriter::new();
    for entry in entries.iter().filter(|entry| entry.kind == EntryKind::File) {
        writer
            .write_file(&entry.path, &entry.content, false)
            .map_err(|error| MkarError::new(MkarErrorCode::InvalidEntry, error.to_string()))?;
    }
    let mut output = Vec::new();
    writer
        .finalize(&mut output)
        .map_err(|error| MkarError::new(MkarErrorCode::InvalidArchive, error.to_string()))?;
    Ok(output)
}
