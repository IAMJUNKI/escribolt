#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC_FILE="$ROOT_DIR/native/macos-fn-key-helper/Sources/main.swift"
INFO_PLIST_TEMPLATE="$ROOT_DIR/native/macos-fn-key-helper/Info.plist"
OUT_DIR="$ROOT_DIR/native/macos-fn-key-helper/bin"
OUT_FILE="$OUT_DIR/macos-fn-key-helper"
MODULE_CACHE_DIR="$ROOT_DIR/.swift-module-cache/macos-fn-key-helper"
INFO_PLIST_BUILD="$MODULE_CACHE_DIR/Info.plist"

if [[ ! -f "$SRC_FILE" ]]; then
  echo "Missing source file: $SRC_FILE" >&2
  exit 1
fi

if [[ ! -f "$INFO_PLIST_TEMPLATE" ]]; then
  echo "Missing Info.plist: $INFO_PLIST_TEMPLATE" >&2
  exit 1
fi

mkdir -p "$OUT_DIR"
mkdir -p "$MODULE_CACHE_DIR"

cp "$INFO_PLIST_TEMPLATE" "$INFO_PLIST_BUILD"
APP_VERSION="$(node -p "require('$ROOT_DIR/package.json').version")"
/usr/libexec/PlistBuddy -c "Set :CFBundleShortVersionString $APP_VERSION" "$INFO_PLIST_BUILD"
/usr/libexec/PlistBuddy -c "Set :CFBundleVersion $APP_VERSION" "$INFO_PLIST_BUILD"

SWIFT_MODULE_CACHE_PATH="$MODULE_CACHE_DIR" \
CLANG_MODULE_CACHE_PATH="$MODULE_CACHE_DIR" \
xcrun swiftc \
  -target arm64-apple-macos13.0 \
  -module-cache-path "$MODULE_CACHE_DIR" \
  "$SRC_FILE" \
  -o "$OUT_FILE" \
  -Xlinker -sectcreate \
  -Xlinker __TEXT \
  -Xlinker __info_plist \
  -Xlinker "$INFO_PLIST_BUILD" \
  -framework AppKit \
  -framework ApplicationServices

chmod +x "$OUT_FILE"
codesign --force --sign - "$OUT_FILE"
echo "Built native helper: $OUT_FILE"
