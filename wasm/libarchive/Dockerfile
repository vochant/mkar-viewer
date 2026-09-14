FROM emscripten/emsdk:5.0.2

RUN apt-get update \
    && apt-get install --no-install-recommends -y ca-certificates curl git make cmake ninja-build python3 xz-utils bzip2 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /work
ENTRYPOINT ["/work/wasm/libarchive/rebuild-in-docker.sh"]
