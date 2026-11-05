# Dependency review — 6 November 2026

Follows the 5 November 2026 security review; the fixes are recorded in
[`docs/security/2026-11-05-pilot-remediation-status.md`](../docs/security/2026-11-05-pilot-remediation-status.md).

## Shipped components

| Component | Version | Notes |
| --- | --- | --- |
| Electron | 45.2.3 (pinned exactly) | Latest stable of the supported lines (43-45). Synchronous `safeStorage` is deprecated in 45 and removed in 46; move to the async API before upgrading to 46. |
| FFmpeg helper | 7.1.5 | Built by `scripts/build-ffmpeg-minimal.sh` from the PGP-verified release tarball; audio-only, no network protocols. `custom/build.sh` refuses any other version. |
| certifi (Python TLS trust store) | 2026.10.23 (pinned) | Drops the compromised "emSign ECC Root CA - G3". |

## JavaScript

`npm audit --omit=dev` reports **zero advisories** for shipped packages.

`npm audit` including build and lint tools reports **14 entries: 1 high,
13 moderate**, from seven upstream advisories. None of these packages is in the
shipped app:

| Package | Pulled in by | Exposure | Decision |
| --- | --- | --- | --- |
| `zod` 3.25.76 (high) | `eslint-plugin-react-hooks` | Lint only; validates the plugin's own options. | Take the fixed version with the next plugin release; no app input reaches it. |
| `fast-uri` (4 advisories) | `electron-builder` → `ajv` | Packaging only; parses the repository's own build config. | Update with electron-builder. |
| `minimatch` | eslint, electron-builder | Build/lint glob patterns from the repository. | Update with the parents. |
| `postcss-selector-parser` | Tailwind 3 | Build-time CSS parsing of the repository's own styles. | Fixed in a major Tailwind 3 does not accept; revisit with the Tailwind migration. |

Do not run builds against untrusted source trees. No `npm audit fix --force`:
it would force unverified major upgrades of the build chain.

## Python

Requirements keep the fork's compatibility constraints (`custom/constraints.txt`)
and the MLX pin; certifi is now pinned explicitly. They were verified by a clean
install and bundle build. They are not a fully hashed, transitively locked set,
and no automated Python advisory scan runs yet; adding `pip-audit` to CI is a
follow-up.

Re-run these audits when updating a lockfile; these counts describe this review,
not a permanent guarantee.
