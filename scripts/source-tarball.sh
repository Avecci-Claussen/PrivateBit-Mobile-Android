#!/bin/sh
# Source tarball of this repo with shared/ filled from the extension checkout.
# Omits private/, node_modules, build outputs and env files.
set -e
ROOT=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
OUT=${1:-"$ROOT/PrivateBit-android-source.tar.gz"}
T=$(mktemp -d)
mkdir -p "$T/PrivateBit-android"
git -C "$ROOT" archive HEAD | tar -x -C "$T/PrivateBit-android"
rm -rf "$T/PrivateBit-android/shared"
mkdir -p "$T/PrivateBit-android/shared"
if git -C "$ROOT/shared" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  git -C "$ROOT/shared" archive HEAD | tar -x -C "$T/PrivateBit-android/shared"
else
  tar -C "$ROOT/shared" \
    --exclude node_modules --exclude dist --exclude dist-e2e --exclude dist-private \
    --exclude e2e-out --exclude release --exclude .git \
    -cf - . | tar -x -C "$T/PrivateBit-android/shared"
fi
if find "$T" \( -name '.env*' -o -name '*.jks' -o -name 'keystore.properties' \) | grep -q .; then
  echo "secret-like file in tree"
  exit 1
fi
tar --sort=name --owner=0 --group=0 --mtime='2026-10-25 00:00Z' -czf "$OUT" -C "$T" PrivateBit-android
rm -rf "$T"
ls -la "$OUT"
