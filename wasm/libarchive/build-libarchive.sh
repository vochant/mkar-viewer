#!/usr/bin/env bash
set -euo pipefail

output=$(realpath "$1")
project=$(realpath "$(dirname "$0")/../..")
sources="$output/sources"
prefix="$output/prefix"
mkdir -p "$output/artifacts"
exec > >(tee "$output/build.log") 2>&1

common=(-G Ninja -DCMAKE_BUILD_TYPE=Release -DCMAKE_INSTALL_PREFIX="$prefix" -DCMAKE_INSTALL_LIBDIR=lib -DCMAKE_PREFIX_PATH="$prefix" -DCMAKE_POLICY_VERSION_MINIMUM=3.5)
emcmake cmake -S "$sources/libarchive" -B "$output/libarchive" "${common[@]}" \
  -DBUILD_SHARED_LIBS=OFF -DENABLE_TEST=OFF -DENABLE_TAR=OFF -DENABLE_CPIO=OFF -DENABLE_CAT=OFF -DENABLE_UNZIP=OFF \
  -DENABLE_XATTR=OFF -DENABLE_ACL=OFF -DENABLE_OPENSSL=OFF -DENABLE_NETTLE=OFF -DENABLE_MD=OFF -DENABLE_LIBB2=OFF \
  -DENABLE_LZO=OFF -DENABLE_EXPAT=OFF -DENABLE_PCREPOSIX=OFF -DENABLE_PCRE2POSIX=OFF \
  -DENABLE_LZ4=ON -DENABLE_LZMA=ON -DENABLE_ZSTD=ON -DENABLE_BZip2=ON \
  -DENABLE_MBEDTLS=ON -DENABLE_LIBXML2=ON -DENABLE_ZLIB=ON -DENABLE_ICONV=ON \
  -DZLIB_INCLUDE_DIR="$prefix/include" -DZLIB_LIBRARY="$prefix/lib/libz.a" \
  -DBZIP2_INCLUDE_DIR="$prefix/include" -DBZIP2_LIBRARY_RELEASE="$prefix/lib/libbz2.a" \
  -DLIBLZMA_INCLUDE_DIR="$prefix/include" -DLIBLZMA_LIBRARY_RELEASE="$prefix/lib/liblzma.a" \
  -DLZ4_INCLUDE_DIR="$prefix/include" -DLZ4_LIBRARY="$prefix/lib/liblz4.a" \
  -DZSTD_INCLUDE_DIR="$prefix/include" -DZSTD_LIBRARY="$prefix/lib/libzstd.a" \
  -DLIBXML2_INCLUDE_DIR="$prefix/include/libxml2" -DLIBXML2_LIBRARY="$prefix/lib/libxml2.a" \
  -DMBEDTLS_INCLUDE_DIRS="$prefix/include" -DMBEDTLS_LIBRARY="$prefix/lib/libmbedtls.a" \
  -DMBEDX509_LIBRARY="$prefix/lib/libmbedx509.a" -DMBEDCRYPTO_LIBRARY="$prefix/lib/libmbedcrypto.a" \
  -DHAVE_FORK=OFF -DHAVE_VFORK=OFF -DHAVE_POSIX_SPAWNP=OFF
for capability in HAVE_LIBXML_XMLWRITER_H HAVE_ZLIB_H HAVE_BZLIB_H HAVE_LZMA_H HAVE_LZ4_H HAVE_ZSTD_H ARCHIVE_CRYPTO_MD5_MBEDTLS ARCHIVE_CRYPTO_SHA1_MBEDTLS ARCHIVE_CRYPTO_SHA256_MBEDTLS; do
  grep -q "^#define $capability 1$" "$output/libarchive/config.h" || { echo "Missing required libarchive capability: $capability" >&2; exit 1; }
done
cmake --build "$output/libarchive" --target archive_static --parallel 4
emcc -O3 --no-entry -DHAVE_CONFIG_H -I"$output/libarchive" -I"$prefix/include" -I"$sources/libarchive/libarchive" "$project/wasm/libarchive/writer.c" "$project/wasm/libarchive/xxencode.c" "$project/wasm/libarchive/shar.c" \
  "$output/libarchive/libarchive/libarchive.a" "$prefix/lib/libxml2.a" "$prefix/lib/libz.a" "$prefix/lib/libbz2.a" "$prefix/lib/liblzma.a" "$prefix/lib/liblz4.a" "$prefix/lib/libzstd.a" "$prefix/lib/libmbedcrypto.a" \
  -sMODULARIZE=1 -sEXPORT_ES6=1 -sENVIRONMENT=web,worker,node -sALLOW_MEMORY_GROWTH=1 -sMAXIMUM_MEMORY=1073741824 -sWASM_BIGINT=1 -sERROR_ON_UNDEFINED_SYMBOLS=1 -sEXPORTED_RUNTIME_METHODS='["cwrap","HEAPU8"]' -sEXPORTED_FUNCTIONS='["_malloc","_free","_la_create","_la_add","_la_finish","_la_error","_la_data","_la_size","_la_free"]' -o "$output/artifacts/libarchive.mjs"
find "$sources" -maxdepth 3 -type f \( -name 'COPYING*' -o -name 'LICENSE*' -o -name 'LICENCE*' \) -not -path '*/.git/*' -print0 | sort -z | while IFS= read -r -d '' license; do relative_license=${license#"$sources/"}; printf '\n===== %s =====\n' "$relative_license"; cat "$license"; done > "$output/artifacts/NOTICE.txt"
sha256sum "$output/artifacts/"* > "$output/artifacts.sha256"
