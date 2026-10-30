#!/usr/bin/env bash
# Rebuilds the dmg that `tauri build` made so its window has a background with
# an arrow from the app to Applications (Tauri 1.x cannot set one), then signs it:
#
#   scripts/rebuild-dmg-with-arrow.sh
#
# Run it after `npm run tauri build -- --target universal-apple-darwin`. The
# result replaces the dmg in place; notarize and staple it afterwards.
set -euo pipefail
cd "$(dirname "$0")/.."
BUNDLE=src-tauri/target/universal-apple-darwin/release/bundle
VERSION=$(node -p "require('./package.json').version")
DMG="WormWorld_${VERSION}_universal.dmg"
IDENTITY=$(node -p "require('./src-tauri/tauri.conf.json').tauri.bundle.macOS.signingIdentity")
[ -d "$BUNDLE/macos/WormWorld.app" ] || { echo "no built app in $BUNDLE/macos"; exit 1; }
[ "$IDENTITY" != "null" ] || { echo "no signingIdentity in tauri.conf.json"; exit 1; }

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
mkdir "$WORK/stage"
ditto "$BUNDLE/macos/WormWorld.app" "$WORK/stage/WormWorld.app"
swift scripts/make-dmg-background.swift "$WORK/background.png"

cd "$BUNDLE/dmg"
rm -f "$DMG"
./bundle_dmg.sh \
  --volname WormWorld --volicon icon.icns \
  --background "$WORK/background.png" \
  --window-size 660 400 --icon-size 128 \
  --icon WormWorld.app 180 170 --hide-extension WormWorld.app \
  --app-drop-link 480 170 \
  "$DMG" "$WORK/stage"
codesign --force --sign "$IDENTITY" "$DMG"
codesign --verify --verbose "$DMG"
ls -l "$DMG"
