#!/usr/bin/env bash
set -euo pipefail

root=/work
mkdir -p "$root/.build/artifacts"
cp /opt/output/artifacts/* "$root/.build/artifacts/"
