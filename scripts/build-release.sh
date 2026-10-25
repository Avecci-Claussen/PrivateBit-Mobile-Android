#!/bin/sh
# Production APKs from this checkout: release (signed when private/keystore.properties exists) and debug.
# JDK 21 and an Android SDK are required. ANDROID_HOME defaults to $HOME/android-sdk.
set -e
ROOT=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
cd "$ROOT"
if [ -z "${ANDROID_HOME:-}" ] && [ -d "$HOME/android-sdk" ]; then
  export ANDROID_HOME="$HOME/android-sdk"
fi
if [ -n "${ANDROID_HOME:-}" ]; then
  export PATH="$ANDROID_HOME/platform-tools:$PATH"
fi
npm run -s build:web
npx cap sync android
if grep -q __pbE2E android/app/src/main/assets/public/assets/*.js; then
  echo "e2e hook in production assets"
  exit 1
fi
(cd android && ./gradlew --no-daemon assembleDebug assembleRelease)
echo BUILT
