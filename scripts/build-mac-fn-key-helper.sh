#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC_FILE="$ROOT_DIR/native/macos-fn-key-helper/Sources/main.swift"
OUT_DIR="$ROOT_DIR/native/macos-fn-key-helper/bin"
OUT_FILE="$OUT_DIR/macos-fn-key-helper"
MODULE_CACHE_DIR="$ROOT_DIR/.swift-module-cache/macos-fn-key-helper"

if [[ ! -f "$SRC_FILE" ]]; then
  echo "Missing source file: $SRC_FILE" >&2
  exit 1
fi

mkdir -p "$OUT_DIR"
mkdir -p "$MODULE_CACHE_DIR"

SWIFT_MODULE_CACHE_PATH="$MODULE_CACHE_DIR" \
CLANG_MODULE_CACHE_PATH="$MODULE_CACHE_DIR" \
xcrun swiftc \
  -target arm64-apple-macos13.0 \
  -module-cache-path "$MODULE_CACHE_DIR" \
  "$SRC_FILE" \
  -o "$OUT_FILE" \
  -framework AppKit \
  -framework ApplicationServices

chmod +x "$OUT_FILE"
echo "Built native helper: $OUT_FILE"
