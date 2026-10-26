# PrivateBit 1.0.0

Locked from the extension checkout `shared/` and this Android shell. versionName `1.0.0`, Android versionCode `6`, application id `com.privatebit.wallet`.

## What was run on this lock

- Extension unit tests: 406 passed, 9 skipped. The skipped files talk to a public explorer, a Fractal node, payjo.in, or the UniSat API, and they stay off unless their own environment variable is set.
- Android package unit tests (extension suite plus the shell suite): 435 passed, 9 skipped. The 29 tests beyond the extension suite are the Android shell.
- Android JVM tests: `LocalHostTest`, `PinnedUrlTest`, `RelayTunnelTest` (8 tests), debug and release, 0 failures.
- Extension `npm run release` for this tag: `scripts/check-dist.mjs` accepted the build. Zip SHA-256 `8bd676ce6b0e973820cd509fd7dcd19ea2e9172312b8fd56a5efa3397e98313b`.
- Release APK from `scripts/build-release.sh`, versionCode 6, signed with the PrivateBit certificate SHA-256 `f7fd699685a9a53adec692e6faaaa902e3ea3be0565a523141e5e567307519d4`. APK SHA-256 `1744b0e0a11c395ad9a0153d70ba62040a6478f65a92657ef11caca6ddf79022`. The release web bundle has no test hook and no unknown 64-character hex constant.
- Unpacked release extension in headless Chromium: full page and popup render, the service worker has no `__pbE2E` hook, and there were no page errors.

Node 22 and JDK 21 were used. The release zip is reproducible from `npm run release` on that Node major with this lockfile.

## What this lock does not claim

- A handset was not used. Fingerprint unlock, notification delivery, the recents thumbnail, a `bitcoin:` link from another app, and a node on the local network still need a phone.
- No live Payjoin was broadcast. The opt-in mailbox test was not run.
- The full screenshot matrix in `shared/e2e/` was not re-run for this lock. `e2e/prod-smoke.mjs` was.
- Public Fractal mode still cannot check merge-mined or indexer proofs, because explorers strip them. `shared/docs/BLOCK-VERIFICATION.md` says what is checked. An own node verifies those proofs. A dishonest explorer can show coins that are not on the real chain. It cannot take keys.
- Fractal and Bitcoin both use `bc1` and `sp1`. The chain chip and the review screen are what stop a payment on the wrong chain.
- Release bytecode is not shrunk (`minifyEnabled` is false). Turning that on without a device pass can break the WebView bridge.
- MIT license. See `LICENSE`. Do not publish a private-test APK or the release keystore.

## What must stay off the public tree

`private/` (release keystore and its passwords), any `UNISAT_API_KEY`, `dist-private/`, `www-private/`, and the private-test APK. Those builds exist to compile a data-service key in, and they are not the public release.
