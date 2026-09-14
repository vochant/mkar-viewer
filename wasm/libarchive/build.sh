#!/usr/bin/env bash
set -euo pipefail

# Native builds keep the same entry point while Docker can cache the two
# expensive stages independently.
sources=$(realpath "$1")
output=$(realpath -m "$2")
mkdir -p "$output"
bash "$(dirname "$0")/build-dependencies.sh" "$sources" "$output"
bash "$(dirname "$0")/build-libarchive.sh" "$output"
