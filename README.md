<img width="2048" height="395" alt="lockup-dark-2048" src="https://github.com/user-attachments/assets/30e778ea-e5f4-4bff-9692-f71b5e9e4457" />


# PrivateBit 1.0.0

Private Bitcoin and Fractal Bitcoin wallet. One receive code, keys that stay on the device, and Payjoin between two PrivateBit users. The Chrome extension and the Android app run the same TypeScript.

| Piece | Where |
| --- | --- |
| Extension source, tests, release gate | `shared/` |
| Android shell (Capacitor, Keystore, native HTTP, biometrics, notifications) | `android/` and the files beside it |
| What this lock verified, and what it did not | `RELEASE.md` |
| How blocks are checked | `shared/docs/BLOCK-VERIFICATION.md` |
| How to report a security problem | `shared/SECURITY.md` |

## Extension

Node 22.

```sh
cd shared
npm ci
npm test
npm run release
```

`npm run release` writes `shared/release/PrivateBit-v1.0.0.zip` and prints its SHA-256. Load that unpacked folder in Chrome. Do not remove an existing PrivateBit install if you want to keep the wallets already stored in it; replace the folder and reload.

## Android

Node 22, JDK 21, Android SDK 36. `ANDROID_HOME` defaults to `$HOME/android-sdk`.

```sh
npm ci
npm test
./scripts/build-release.sh
```

The release APK is signed only when `private/keystore.properties` exists. That directory is gitignored. It holds the update key and its passwords, and it must not be committed. Without it, the release build is unsigned.

A private test build can compile a data-service key into the app. Set `UNISAT_API_KEY` in the environment and run `scripts/build-private.sh`. Never publish that APK.

## License

MIT. See [LICENSE](LICENSE). Third-party licenses for the bundled fonts and icons are in `shared/public/licenses/`.
