#!/usr/bin/env bash
set -euo pipefail

sources=$(realpath "$1")
output=$(realpath -m "$2")
mkdir -p "$output" "$output/prefix" "$output/sources"
cp -a --reflink=never "$sources/." "$output/sources/"
sources="$output/sources"
tar -xzf "$sources/bzip2-1.0.8.tar.gz" -C "$sources"

prefix="$output/prefix"
common=(-G Ninja -DCMAKE_BUILD_TYPE=Release -DCMAKE_INSTALL_PREFIX="$prefix" -DCMAKE_INSTALL_LIBDIR=lib -DCMAKE_PREFIX_PATH="$prefix" -DCMAKE_POLICY_VERSION_MINIMUM=3.5)
build_install() { cmake --build "$output/$1" --parallel 4; cmake --install "$output/$1"; }
(
  cd "$sources/zlib"
  emconfigure ./configure --static --prefix="$prefix"
  emmake make -j4 libz.a
  emmake make install
)
(
  cd "$sources/bzip2-1.0.8"
  emmake make -j4 CC=emcc AR=emar RANLIB=emranlib libbz2.a
  cp libbz2.a "$prefix/lib/"
  cp bzlib.h "$prefix/include/"
)
emcmake cmake -S "$sources/xz" -B "$output/xz" "${common[@]}" -DBUILD_SHARED_LIBS=OFF -DBUILD_TESTING=OFF -DXZ_THREADS=no -DXZ_TOOL_XZ=OFF -DXZ_TOOL_XZDEC=OFF -DXZ_TOOL_LZMADEC=OFF -DXZ_TOOL_LZMAINFO=OFF -DXZ_DOC=OFF
build_install xz
emcmake cmake -S "$sources/lz4/build/cmake" -B "$output/lz4" "${common[@]}" -DBUILD_SHARED_LIBS=OFF -DBUILD_STATIC_LIBS=ON -DLZ4_BUILD_CLI=OFF -DLZ4_BUILD_LEGACY_LZ4C=OFF
build_install lz4
emcmake cmake -S "$sources/zstd/build/cmake" -B "$output/zstd" "${common[@]}" -DZSTD_BUILD_SHARED=OFF -DZSTD_BUILD_STATIC=ON -DZSTD_BUILD_PROGRAMS=OFF -DZSTD_BUILD_TESTS=OFF -DZSTD_MULTITHREAD_SUPPORT=OFF
build_install zstd
emcmake cmake -S "$sources/mbedtls" -B "$output/mbedtls" "${common[@]}" -DENABLE_PROGRAMS=OFF -DENABLE_TESTING=OFF -DUSE_SHARED_MBEDTLS_LIBRARY=OFF -DUSE_STATIC_MBEDTLS_LIBRARY=ON -DMBEDTLS_FATAL_WARNINGS=OFF
build_install mbedtls
emcmake cmake -S "$sources/libxml2" -B "$output/libxml2" "${common[@]}" \
  -DBUILD_SHARED_LIBS=OFF -DLIBXML2_WITH_PROGRAMS=OFF -DLIBXML2_WITH_TESTS=OFF -DLIBXML2_WITH_PYTHON=OFF \
  -DLIBXML2_WITH_THREADS=OFF -DLIBXML2_WITH_MODULES=OFF -DLIBXML2_WITH_HTTP=OFF -DLIBXML2_WITH_LZMA=OFF \
  -DLIBXML2_WITH_ZLIB=OFF -DLIBXML2_WITH_READER=ON -DLIBXML2_WITH_WRITER=ON
build_install libxml2
