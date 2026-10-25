# Changelog

## 1.0.0 (versionCode 3), security audit v1

Same version name. versionCode 3 installs over versionCode 2 and keeps wallet data. Full report:
SECURITY-AUDIT-v1.md next to the deliverables.

### Security
- Payjoin receive: coins received on Fractal or Bitcoin with an odd spend key are spendable again.
  Payment link outputs are now derived from the seed, so a restore finds them.
- Site signing: only SIGHASH_DEFAULT and ALL are signed; ALL|ANYONECANPAY with a warning; SINGLE
  and NONE variants are refused.
- Payment links from other apps show "Opened from a link in another app". Links with test network
  codes or amounts with more than 8 decimals are refused.
- New passwords need at least 12 characters. Stored vaults move to the stronger key setting on the
  next unlock.
- Downloaded blocks are checked (merkle root, and proof of work where the block carries it).
- A Payjoin link that the payer never completes sends the payer's original payment after the
  deadline. The wallet locks at most 2 hours after the usual time while a Payjoin is waiting.
- Node connections over http connect to the address that was checked (no DNS rebinding).
- Sites can only relay transactions that spend their own account, at most 5 a minute, wait a
  minute after 3 rejections, and get http only on local addresses. High site fees are called out.

## 1.0.0 (versionCode 2)

Same version name as the first test build, with versionCode 2 so it installs over it and keeps wallet data.

### Fixed
- Payjoin: the sender's change (a Silent Payment output to its own change code) is now found, shown
  in the balance, Coins and the "Back to you" row, and recovered for wallets that already made such
  a payment with the first test build on the next sync or rescan.
- Narrow phones and large text: nothing is cut off or wider than the screen from 320 px wide at
  Android font scale 1.3. Text scale now resizes text and line height together.

### Added
- Unlock with fingerprint or face: offered after setup and in Settings > Security, opens by itself on
  the lock screen, "Use password" always available, clear wording when the phone has no sensor or
  none is set up, and after a restart, 5 failed tries, a sensor change or a password change.
- Notifications (opt-in): payment received, payment confirmed, delayed payment sent, Payjoin
  completed, payment not sent. Private by default, optional amounts, Payments and Sending channels,
  background confirmation check every 15 minutes while on.

### Changed
- Launcher, round, themed and splash icons: the mark is optically centered in the safe zone.
- Touch targets are at least 48 dp; the bottom tabs hide while the keyboard is up; sheets respect
  the gesture bar.
- versionCode 2, versionName 1.0.0 (installs over the first test build, data kept).
