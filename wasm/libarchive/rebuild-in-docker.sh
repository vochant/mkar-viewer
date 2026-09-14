#!/usr/bin/env bash
set -euo pipefail

root=/work
sources="$root/.build/sources"
output="$root/.build/output"
lock="$root/wasm/libarchive/sources.json"
mkdir -p "$sources"

python3 - "$lock" "$sources" <<'PY'
import json, subprocess, sys
lock, root = sys.argv[1:]
data = json.load(open(lock))
for name, source in data["repositories"].items():
    target = f"{root}/{name}"
    try:
        revision = subprocess.check_output(["git", "-C", target, "rev-parse", "HEAD"], text=True).strip()
    except subprocess.CalledProcessError:
        revision = ""
    if revision != source["revision"]:
        subprocess.run(["rm", "-rf", target], check=True)
        subprocess.run(["git", "clone", "--revision", source["revision"], "--depth", "1", source["url"], target], check=True)
PY
git -C "$sources/mbedtls" submodule update --init --depth 1
python3 - "$lock" "$sources/bzip2-1.0.8.tar.gz" <<'PY'
import json, shutil, subprocess, sys
lock, output = sys.argv[1:]
data = json.load(open(lock))["bzip2"]
subprocess.run(["curl", "--fail", "--location", "--retry", "2", data["url"], "--output", output], check=True)
actual = subprocess.check_output(["sha256sum", output], text=True).split()[0]
if actual != data["sha256"]: raise SystemExit("bzip2 checksum mismatch")
PY
bash "$root/wasm/libarchive/build.sh" "$sources" "$output"
mkdir -p "$root/.build/artifacts"
cp "$output/artifacts/"* "$root/.build/artifacts/"
