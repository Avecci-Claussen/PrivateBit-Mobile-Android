#!/bin/sh
# Test-only APK (mock chain) for the emulator flow. Never shipped.
set -e
ROOT=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
cd "$ROOT"
if [ -z "${ANDROID_HOME:-}" ] && [ -d "$HOME/android-sdk" ]; then
  export ANDROID_HOME="$HOME/android-sdk"
fi
npx vite build --mode e2e
PB_WEBDIR=www-e2e npx cap sync android
(cd android && ./gradlew --no-daemon assembleDebug)
cp android/app/build/outputs/apk/debug/app-debug.apk "${1:-/tmp/pb-e2e.apk}"
echo BUILT
