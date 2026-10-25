#!/bin/sh
# Private test APK: the data service key is compiled in. Never publish.
# Pass the key only through the UNISAT_API_KEY environment variable. This script does not read a file.
set -e
ROOT=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
cd "$ROOT"
if [ -z "${ANDROID_HOME:-}" ] && [ -d "$HOME/android-sdk" ]; then
  export ANDROID_HOME="$HOME/android-sdk"
fi
if [ -z "${UNISAT_API_KEY:-}" ]; then
  echo "UNISAT_API_KEY is not set"
  exit 1
fi
npx vite build --mode private
if grep -qF "$UNISAT_API_KEY" www-private/assets/*.js; then
  echo "key compiled in: yes (length ${#UNISAT_API_KEY})"
else
  echo "key missing"
  exit 1
fi
PB_WEBDIR=www-private npx cap sync android
(cd android && ./gradlew --no-daemon assembleRelease -PpbPrivate)
install -m 600 android/app/build/outputs/apk/release/app-release.apk "${1:-$ROOT/PrivateBit-android-PRIVATE-TEST.apk}"
# Restore the public bundle in the project. The private APK is already written.
npx cap sync android
echo BUILT
