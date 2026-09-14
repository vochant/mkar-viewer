use base64::Engine;
use remkar_wasm::{DecodeLimits, EntryKind, decode_archive_bytes};
use sha2::{Digest, Sha256};

#[test]
fn decodes_native_remkar_fixture() {
    let encoded = include_str!("fixtures/remkar-basic.mkar.b64");
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(encoded.split_whitespace().collect::<String>())
        .unwrap();

    let entries = decode_archive_bytes(&bytes, DecodeLimits::default()).unwrap();

    assert!(entries.iter().any(|entry| {
        entry.path == "tree/hello.txt"
            && entry.kind == EntryKind::File
            && entry.content == b"hello\n"
    }));
    assert!(entries.iter().any(|entry| {
        entry.path == "tree/nested/empty.txt"
            && entry.kind == EntryKind::File
            && entry.content.is_empty()
    }));
    assert!(
        entries
            .iter()
            .any(|entry| { entry.path == "tree/empty" && entry.kind == EntryKind::Folder })
    );
}

#[test]
fn decodes_native_mkar_minimized_fixture() {
    let encoded = include_str!("fixtures/mkar-minimized-basic.mkar.b64");
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(encoded.split_whitespace().collect::<String>())
        .unwrap();

    let entries = decode_archive_bytes(&bytes, DecodeLimits::default()).unwrap();

    assert!(
        entries
            .iter()
            .any(|entry| { entry.path == "tree/hello.txt" && entry.content == b"hello\n" })
    );
    assert!(entries.iter().any(|entry| entry.path == "tree/empty"));
}

#[test]
fn decodes_native_remkar_zstd_fixture() {
    let encoded = include_str!("fixtures/remkar-compressed-styles.mkar.b64");
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(encoded.split_whitespace().collect::<String>())
        .unwrap();

    let entries = decode_archive_bytes(&bytes, DecodeLimits::default()).unwrap();
    let styles = entries
        .iter()
        .find(|entry| entry.path == "styles.css")
        .unwrap();

    assert_eq!(styles.content.len(), 6_325);
    assert_eq!(
        format!("{:x}", Sha256::digest(&styles.content)),
        "2a8b43231edb0dcc8fd697db8755803ad46e64459370dfa677722a842325dbd7",
    );
}
