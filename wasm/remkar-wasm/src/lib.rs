mod error;
mod format;
mod model;
mod reader;
mod writer;

use crate::error::MkarError;
use crate::model::{
    ArchiveEntry, EncodeOptions, ManifestInput, PlannedArchiveEntry, RequestedLimits, TarOptions,
};
use std::io::Cursor;
use wasm_bindgen::prelude::*;

pub use crate::model::{DecodeLimits, EntryKind};
pub use crate::reader::decode_archive_bytes;
pub use crate::writer::encode_archive_bytes;

#[wasm_bindgen(js_name = decodeArchive)]
pub fn decode_archive(input: &[u8], requested: JsValue) -> Result<JsValue, JsValue> {
    let requested = if requested.is_null() || requested.is_undefined() {
        RequestedLimits::default()
    } else {
        serde_wasm_bindgen::from_value(requested).map_err(|error| {
            to_js_error(MkarError::new(
                error::MkarErrorCode::InvalidEntry,
                format!("Invalid decode options: {error}"),
            ))
        })?
    };
    let entries = reader::decode_archive_bytes(input, DecodeLimits::from_requested(requested))
        .map_err(to_js_error)?;
    serde_wasm_bindgen::to_value(&entries).map_err(|error| {
        to_js_error(MkarError::new(
            error::MkarErrorCode::InvalidEntry,
            format!("Could not serialize decoded entries: {error}"),
        ))
    })
}

#[wasm_bindgen(js_name = encodeArchive)]
pub fn encode_archive(entries: JsValue, options: JsValue) -> Result<Vec<u8>, JsValue> {
    let entries: Vec<ArchiveEntry> = serde_wasm_bindgen::from_value(entries).map_err(|error| {
        to_js_error(MkarError::new(
            error::MkarErrorCode::InvalidEntry,
            format!("Invalid archive entries: {error}"),
        ))
    })?;
    let options = if options.is_null() || options.is_undefined() {
        EncodeOptions::default()
    } else {
        serde_wasm_bindgen::from_value(options).map_err(|error| {
            to_js_error(MkarError::new(
                error::MkarErrorCode::InvalidEntry,
                format!("Invalid encode options: {error}"),
            ))
        })?
    };
    writer::encode_archive_bytes(&entries, options).map_err(to_js_error)
}

#[wasm_bindgen(js_name = inspectEntryPrefix)]
pub fn inspect_entry_prefix(input: &[u8], version: u16, index: u32) -> Result<JsValue, JsValue> {
    let prefix = reader::inspect_entry_prefix(input, version, index).map_err(to_js_error)?;
    serialize(&prefix, "Could not serialize entry prefix")
}

#[wasm_bindgen(js_name = inspectEntryMetadata)]
pub fn inspect_entry_metadata(input: &[u8], version: u16, index: u32) -> Result<JsValue, JsValue> {
    let metadata = reader::inspect_entry_metadata(input, version, index).map_err(to_js_error)?;
    serialize(&metadata, "Could not serialize entry metadata")
}

#[wasm_bindgen(js_name = inspectEntryProp)]
pub fn inspect_entry_prop(input: &[u8], index: u32) -> Result<JsValue, JsValue> {
    let prefix = reader::inspect_entry_prop(input, index).map_err(to_js_error)?;
    serialize(&prefix, "Could not serialize entry property")
}

#[wasm_bindgen(js_name = decodeStoredEntry)]
pub fn decode_stored_entry(
    input: &[u8],
    version: u16,
    requested: JsValue,
    index: u32,
    password: JsValue,
) -> Result<JsValue, JsValue> {
    let limits = decode_limits(requested)?;
    let password = password.as_string();
    let entry = reader::decode_stored_entry(input, version, limits, index, password.as_deref())
        .map_err(to_js_error)?;
    serialize(&entry, "Could not serialize decoded entry")
}

#[wasm_bindgen(js_name = buildManifest)]
pub fn build_manifest(entries: JsValue, requested: JsValue) -> Result<JsValue, JsValue> {
    let entries: Vec<ManifestInput> = deserialize(entries, "Invalid manifest entries")?;
    let manifest =
        reader::build_manifest(entries, decode_limits(requested)?).map_err(to_js_error)?;
    serialize(&manifest, "Could not serialize archive manifest")
}

#[wasm_bindgen(js_name = planArchive)]
pub fn plan_archive(entries: JsValue, options: JsValue) -> Result<JsValue, JsValue> {
    let entries: Vec<ArchiveEntry> = deserialize(entries, "Invalid archive entries")?;
    let options = encode_options(options)?;
    let plan = writer::plan_archive_entries(&entries, &options).map_err(to_js_error)?;
    serialize(&plan, "Could not serialize archive plan")
}

#[wasm_bindgen(js_name = encodePlannedEntry)]
pub fn encode_planned_entry(
    entry: JsValue,
    content: &[u8],
    options: JsValue,
) -> Result<Vec<u8>, JsValue> {
    let entry: PlannedArchiveEntry = deserialize(entry, "Invalid planned entry")?;
    let options = encode_options(options)?;
    writer::encode_planned_entry(&entry, content, &options).map_err(to_js_error)
}

#[wasm_bindgen(js_name = encodeAr)]
pub fn encode_ar(entries: JsValue) -> Result<Vec<u8>, JsValue> {
    let entries: Vec<ArchiveEntry> = deserialize(entries, "Invalid ar entries")?;
    writer::encode_ar(&entries).map_err(to_js_error)
}

#[wasm_bindgen(js_name = encodeSevenZ)]
pub fn encode_seven_z(entries: JsValue) -> Result<Vec<u8>, JsValue> {
    let entries: Vec<ArchiveEntry> = deserialize(entries, "Invalid 7z entries")?;
    writer::encode_seven_z(&entries).map_err(to_js_error)
}

#[wasm_bindgen(js_name = encodeCpio)]
pub fn encode_cpio(entries: JsValue) -> Result<Vec<u8>, JsValue> {
    let entries: Vec<ArchiveEntry> = deserialize(entries, "Invalid cpio entries")?;
    writer::encode_cpio(&entries).map_err(to_js_error)
}

#[wasm_bindgen(js_name = encodeCab)]
pub fn encode_cab(entries: JsValue) -> Result<Vec<u8>, JsValue> {
    let entries: Vec<ArchiveEntry> = deserialize(entries, "Invalid CAB entries")?;
    writer::encode_cab(&entries).map_err(to_js_error)
}

#[wasm_bindgen(js_name = encodeLzh)]
pub fn encode_lzh(entries: JsValue) -> Result<Vec<u8>, JsValue> {
    let entries: Vec<ArchiveEntry> = deserialize(entries, "Invalid LZH entries")?;
    writer::encode_lzh(&entries).map_err(to_js_error)
}

#[wasm_bindgen(js_name = encodeZip)]
pub fn encode_zip(entries: JsValue) -> Result<Vec<u8>, JsValue> {
    let entries: Vec<ArchiveEntry> = deserialize(entries, "Invalid ZIP entries")?;
    writer::encode_zip(&entries).map_err(to_js_error)
}

#[wasm_bindgen(js_name = encodeTar)]
pub fn encode_tar(entries: JsValue, options: JsValue) -> Result<Vec<u8>, JsValue> {
    let entries: Vec<ArchiveEntry> = deserialize(entries, "Invalid tar entries")?;
    let options: TarOptions = deserialize(options, "Invalid tar options")?;
    writer::encode_tar(&entries, options).map_err(to_js_error)
}

#[wasm_bindgen(js_name = encodeTarGz)]
pub fn encode_tar_gz(entries: JsValue, options: JsValue) -> Result<Vec<u8>, JsValue> {
    let entries: Vec<ArchiveEntry> = deserialize(entries, "Invalid tar.gz entries")?;
    let options: TarOptions = deserialize(options, "Invalid tar options")?;
    writer::encode_tar_gz(&entries, options).map_err(to_js_error)
}

#[wasm_bindgen(js_name = compressZstd)]
pub fn compress_zstd(input: &[u8]) -> Result<Vec<u8>, JsValue> {
    zstd::stream::encode_all(Cursor::new(input), 11).map_err(|error| {
        to_js_error(MkarError::new(
            error::MkarErrorCode::InvalidEntry,
            format!("Could not compress tar.zst payload: {error}"),
        ))
    })
}

#[wasm_bindgen(js_name = compressXz)]
pub fn compress_xz(input: &[u8]) -> Result<Vec<u8>, JsValue> {
    let mut reader = Cursor::new(input);
    let mut output = Vec::new();
    lzma_rs::xz_compress(&mut reader, &mut output).map_err(|error| {
        to_js_error(MkarError::new(
            error::MkarErrorCode::InvalidEntry,
            format!("Could not compress tar.xz payload: {error}"),
        ))
    })?;
    Ok(output)
}

#[wasm_bindgen(js_name = compressBzip2)]
pub fn compress_bzip2(input: &[u8]) -> Result<Vec<u8>, JsValue> {
    writer::compress_bzip2(input).map_err(to_js_error)
}

#[wasm_bindgen(js_name = compressLz4)]
pub fn compress_lz4(input: &[u8]) -> Result<Vec<u8>, JsValue> {
    writer::compress_lz4(input).map_err(to_js_error)
}

#[wasm_bindgen(js_name = compressLzma)]
pub fn compress_lzma(input: &[u8]) -> Result<Vec<u8>, JsValue> {
    writer::compress_lzma(input).map_err(to_js_error)
}

#[wasm_bindgen(js_name = compressLz)]
pub fn compress_lz(input: &[u8]) -> Result<Vec<u8>, JsValue> {
    writer::compress_lz(input).map_err(to_js_error)
}

#[wasm_bindgen(js_name = compressBrotli)]
pub fn compress_brotli(input: &[u8]) -> Result<Vec<u8>, JsValue> {
    writer::compress_brotli(input).map_err(to_js_error)
}

fn decode_limits(requested: JsValue) -> Result<DecodeLimits, JsValue> {
    let requested = if requested.is_null() || requested.is_undefined() {
        RequestedLimits::default()
    } else {
        deserialize(requested, "Invalid decode options")?
    };
    Ok(DecodeLimits::from_requested(requested))
}

fn encode_options(options: JsValue) -> Result<EncodeOptions, JsValue> {
    if options.is_null() || options.is_undefined() {
        Ok(EncodeOptions::default())
    } else {
        deserialize(options, "Invalid encode options")
    }
}

fn deserialize<T: serde::de::DeserializeOwned>(
    value: JsValue,
    context: &str,
) -> Result<T, JsValue> {
    serde_wasm_bindgen::from_value(value).map_err(|error| {
        to_js_error(MkarError::new(
            error::MkarErrorCode::InvalidEntry,
            format!("{context}: {error}"),
        ))
    })
}

fn serialize<T: serde::Serialize>(value: &T, context: &str) -> Result<JsValue, JsValue> {
    serde_wasm_bindgen::to_value(value).map_err(|error| {
        to_js_error(MkarError::new(
            error::MkarErrorCode::InvalidEntry,
            format!("{context}: {error}"),
        ))
    })
}

fn to_js_error(error: MkarError) -> JsValue {
    let js_error = js_sys::Error::new(&error.message);
    let details = error.details();
    let object: &JsValue = js_error.as_ref();
    let _ = js_sys::Reflect::set(object, &"code".into(), &details.code.into());
    if let Some(entry) = details.entry {
        let _ = js_sys::Reflect::set(object, &"entry".into(), &entry.into());
    }
    if let Some(key_index) = details.key_index {
        let _ = js_sys::Reflect::set(object, &"keyIndex".into(), &key_index.into());
    }
    js_error.into()
}

#[cfg(test)]
mod tests {
    use super::{compress_brotli, compress_xz, compress_zstd};
    use crate::model::{DecodeLimits, RequestedLimits};
    use std::io::Cursor;

    #[test]
    fn caller_cannot_raise_compiled_limits() {
        let limits = DecodeLimits::from_requested(RequestedLimits {
            max_entries: Some(20_000),
            ..Default::default()
        });

        assert_eq!(limits.max_entries, 10_000);
    }

    #[test]
    fn tar_compressors_emit_readable_streams() {
        let input = b"tar payload";
        let zstd = compress_zstd(input).unwrap();
        let restored = zstd::stream::decode_all(Cursor::new(zstd)).unwrap();
        assert_eq!(restored, input);

        let xz = compress_xz(input).unwrap();
        assert_eq!(&xz[..6], b"\xfd7zXZ\x00");
        let mut restored = Vec::new();
        lzma_rs::xz_decompress(&mut Cursor::new(xz), &mut restored).unwrap();
        assert_eq!(restored, input);

        let brotli = compress_brotli(input).unwrap();
        let restored = oxiarc_archive::BrotliReader::from_bytes(brotli)
            .unwrap()
            .decompress()
            .unwrap();
        assert_eq!(restored, input);
    }
}
