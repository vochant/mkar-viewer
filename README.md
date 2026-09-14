# MKAR Viewer

MKAR Viewer is a browser-based archive workspace. It lets you import an MKAR archive, inspect its entries, configure compression and encryption, and export the resulting tree to several archive formats without uploading files to a server.

## Features

- Client-side archive creation and inspection.
- MKAR read/write support, including entry-level compression and encryption controls.
- Standard archive output through a statically bundled libarchive WebAssembly build.
- Dedicated Web Worker execution for libarchive exports.
- Brotli, CAB, LZH, and AR support through the Rust/Wasm backend.
- Progress reporting for archive operations where the backend can provide it.

## Supported Formats

The application currently exposes:

- MKAR
- ZIP, 7z, CAB, LZH, AR, CPIO, XAR, ISO9660, and shar
- TAR, including GNU, PAX, USTAR, and V7 variants
- `tar.gz`, `tar.bz2`, `tar.xz`, `tar.zst`, `tar.lz4`, `tar.lzma`, `tar.lz`, and `tar.Z`
- `tar.uu`, `tar.b64`, `tar.xx`, and `tar.br`

`tar.br` is implemented as two stages: TAR creation followed by Brotli compression. LRZ/lrzip is intentionally not supported.

## Development

Requirements:

- Node.js with npm
- Rust and Cargo for rebuilding the Rust/Wasm backend
- Docker and a working Docker daemon only when rebuilding libarchive

Install dependencies and start the development server:

```sh
npm install
npm run dev
```

## Commands

```sh
npm test                 # Run the Vitest suite
npm run test:archive     # Run archive interoperability tests
npm run test:rust        # Run Rust/Wasm backend tests
npx tsc -b               # Type-check the project
npm run build            # Build the production application
```

The normal `wasm:build` path uses the Rust build cache and the checked-in libarchive artifacts. It does not compile libarchive.

## Rebuilding libarchive

The libarchive WebAssembly output is intentionally committed under `wasm/libarchive/prebuilt/` so normal development does not require a long native build. Source versions and SHA-256 checksums are locked in `wasm/libarchive/sources.json`.

```sh
npm run libarchive:rebuild
```

The Dockerfile is split into cacheable stages. Downloaded sources and third-party libraries are built separately from libarchive and the project-owned writer/filter wrapper. Changes to `writer.c` or `xxencode.c` therefore reuse the expensive dependency layer.

For local debugging only, `LIBARCHIVE_NATIVE_BUILD=1 npm run libarchive:rebuild` uses the host toolchain and requires a matching Emscripten installation.

## Architecture

- React and TypeScript provide the browser UI.
- The Rust/Wasm backend handles MKAR and the formats that depend on its existing behavior.
- libarchive is statically linked into a modular Emscripten output. Its JavaScript module and Wasm binary are statically imported by the libarchive worker; module initialization is lazy.
- Generated build outputs under `src/generated/` are ignored. The reproducible libarchive artifacts under `wasm/libarchive/prebuilt/` are the checked-in build result.

## License

This repository combines project code with third-party libraries. The libarchive build collects applicable upstream license notices in `wasm/libarchive/prebuilt/NOTICE.txt`.
