# libarchive WebAssembly Build

This directory contains the reproducible build for the libarchive backend used by MKAR Online.

## Overview

The build produces a modular Emscripten JavaScript module and a WebAssembly binary. The browser imports both from the libarchive worker, while initialization remains lazy until the first standard-format export.

The checked-in artifacts are `prebuilt/libarchive.mjs`, `prebuilt/libarchive.wasm`, `prebuilt/manifest.json`, and `prebuilt/NOTICE.txt`. Normal development uses these artifacts directly.

## Build Inputs

`sources.json` locks Emscripten `5.0.2`, libarchive `3.8.9`, libxml2 `2.13.8`, mbedTLS `3.6.3`, zlib `1.3.1`, xz `5.6.3`, lz4 `1.10.0`, zstd `1.5.7`, and bzip2 `1.0.8`.

Every release package has a URL, version, and SHA-256 checksum. The fetch script downloads release archives only; it does not clone repositories or resolve moving Git revisions.

## Rebuild

Run this from the project root:

```sh
npm run libarchive:rebuild
```

The default path builds `Dockerfile` and copies the resulting artifacts into `prebuilt/`. For host-toolchain debugging:

```sh
LIBARCHIVE_NATIVE_BUILD=1 npm run libarchive:rebuild
```

This mode requires a matching local Emscripten installation and is not the preferred release build.

## Docker Cache Layout

The Dockerfile separates expensive work into layers:

1. Locked source metadata and source downloads.
2. Static third-party dependencies: zlib, bzip2, xz, lz4, zstd, mbedTLS, and libxml2.
3. libarchive configuration and compilation.
4. The project-owned writer, xxencode filter, and final Emscripten link.

The scripts mirror this layout:

- `fetch-sources.py` downloads and verifies source packages.
- `build-dependencies.sh` builds and installs third-party static libraries.
- `build-libarchive.sh` configures libarchive and links the final module.
- `build.sh` invokes both build stages for native builds.

Changing `writer.c` or `xxencode.c` should invalidate only the final image layer. Changing a dependency lock or dependency build options invalidates the relevant earlier layer.

## Enabled Formats

libarchive handles ZIP, 7z, CPIO, XAR, ISO9660, shar, TAR variants, and TAR filters including gzip, bzip2, xz, zstd, lz4, lzma, lzip, traditional `compress` (`tar.Z`), uuencode, Base64, and the project-owned xxencode filter.

`tar.br` remains outside libarchive because it is created as a TAR stream and compressed with the Rust/Wasm Brotli path as a separate stage. LRZ/lrzip is not part of the supported build.

## Verification

After rebuilding, run:

```sh
npm run test:archive
npx tsc -b
npm run build
```

`prebuilt/manifest.json` records the source digest and artifact checksums; stale or mismatched artifacts are rejected by the preparation script.

## Licensing

`NOTICE.txt` is generated from license files in the locked source packages. Keep it with the checked-in artifacts when distributing or reviewing a rebuild.
