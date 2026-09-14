FROM emscripten/emsdk:5.0.2

RUN apt-get update \
    && apt-get install --no-install-recommends -y ca-certificates curl git make cmake ninja-build python3 xz-utils bzip2 \
    && rm -rf /var/lib/apt/lists/*

COPY wasm/libarchive /opt/wasm/libarchive

RUN mkdir -p /opt/sources /opt/output \
    && python3 /opt/wasm/libarchive/fetch-sources.py \
    && bash /opt/wasm/libarchive/build.sh /opt/sources /opt/output

WORKDIR /work
ENTRYPOINT ["/work/wasm/libarchive/rebuild-in-docker.sh"]
