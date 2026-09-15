#!/usr/bin/env bash
# Fetch the upstream Persian dictionary that data/lexicon/fa-stems.bin is built
# from. The download lands in data/lexicon/upstream/, which is gitignored; only
# the small derived artifact and its provenance record are committed.
#
# Source: Lilak fa-IR (Apache-2.0), via the npm package dictionary-fa, which
# redistributes the same dictionary and restates the license.
set -euo pipefail

VERSION="${1:-2.0.0}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEST="$ROOT/data/lexicon/upstream"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "fetching dictionary-fa@$VERSION"
curl -sSL --fail --max-time 120 \
  -o "$TMP/dictionary-fa.tgz" \
  "https://registry.npmjs.org/dictionary-fa/-/dictionary-fa-$VERSION.tgz"

tar xzf "$TMP/dictionary-fa.tgz" -C "$TMP"
mkdir -p "$DEST"
cp "$TMP/package/index.dic" "$DEST/fa-IR.dic"
cp "$TMP/package/index.aff" "$DEST/fa-IR.aff"
cp "$TMP/package/license"   "$DEST/LICENSE"

echo "wrote:"
shasum -a 256 "$DEST"/* 2>/dev/null || sha256sum "$DEST"/*
echo
echo "now run: node scripts/build-lexicon.ts"
