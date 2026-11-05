# Security remediation status for the colleague pilot

Point-in-time record against the 2026-11-05 security review (F01-F10) and
`SECURITY_REMEDIATION_PLAN.md`. Branch `security/pilot-hardening`.

| ID | Finding | Status | Evidence |
| --- | --- | --- | --- |
| F01 | Compromised emSign root in the bundled CA store | **Fixed in source**; bundle check below | `certifi==2026.10.23` pinned in `requirements.txt`; `tests/test_tls_trust_store.py` fails if "emSign ECC Root CA - G3" returns or certifi drops below 2026.10.19 |
| F02 | Electron 42 outside supported lines | **Fixed in source; packaged checks pending** | `electron` pinned to exactly 45.2.3 (latest stable, longest support window; 43-45 are supported). Breaking changes 43-45 reviewed against the code: only `openAsHidden` (removed in 44, inert since macOS 13) needed removing; system audio uses `setDisplayMediaRequestHandler` with no permission handler, so 45's `display-capture` change does not apply; no clipboard, preload Node modules or ASAR descriptors in use. Synchronous `safeStorage` is deprecated in 45 but supported; kept so existing encrypted keys keep decrypting, to be moved before Electron 46. Unit, T1 191/191, T2 159 passed (2 load flakes passed on solo reruns). Packaged checks (system audio, Keychain, login item) by the user. |
| F03 | FFmpeg 7.1.1 | **Fixed** | `scripts/build-ffmpeg-minimal.sh` pins 7.1.5 (tarball PGP signature checked against FFmpeg release key FCF986EA15E6E293A5644F10B4322F04D67658D8, sha256 de668509…558f), same minimal audio-only, no-network configuration; component lists identical to the 7.1.1 helper. The custom build replaces the official helper with it (`custom/patched-ffmpeg.sh`, `custom/stage-official-binaries.sh`) and `custom/build.sh` fails if the bundled ffmpeg is not the pinned version. Bundled `dist/stenoai/_internal/ffmpeg` reports 7.1.5 (sha256 fcfc8050…98fa after packaging). `scripts/test-ffmpeg-minimal.sh`: 22/22 (all 12 import formats, pipeline filters, outputs, truncated input, no network); `@pipeline` T2 transcription, honest-failure and watched-folder import pass. |
| F04 | Summarisation key reused after an endpoint change | **Fixed** | `app/cloud-key-store.js`: the encrypted key is an envelope bound to its destination (provider + origin; Bedrock by region). It is released only while the config names that destination, and passed with it (`STENOAI_CLOUD_KEY_DESTINATION`); `Config.get_cloud_api_key` re-derives the destination from the config the job uses and withholds the key on any difference, which also covers a change racing a running job. OpenAI/Anthropic clients get an explicit base URL so `OPENAI_BASE_URL`/`ANTHROPIC_BASE_URL` cannot redirect the key. A pre-binding key is adopted only by first-party destinations; for a custom URL it must be entered again, and Settings says so. `tests/fixtures/cloud_key_destinations.json` is shared by the JS and Python tests; `tests/test_cloud_key_binding.py` uses two loopback servers and asserts the second receives no key; `ai-provider.t2` covers host, port and back. |
| F05 | Bearer token followed redirects | **Fixed** | `src/secure_http.py` refuses every redirect on credentialed urllib calls (adapter chat/stream, Bedrock, Bedrock key test). `tests/test_secure_http.py` drives 301/302/303/307/308 and same-origin redirects against local servers and asserts the second server receives nothing. |
| F06 | Plain http to remote endpoints | **Fixed** | `src/endpoint_policy.py` and `app/endpoint-policy.js`: https, or http only to loopback; no credentials in URLs. Enforced when saved and again when used (legacy values). `tests/test_endpoint_policy.py`, `app/endpoint-policy.test.js`, `e2e/specs/endpoint-security.t2.spec.ts`. LAN Ollama over plain http now needs an HTTPS proxy or an SSH tunnel to localhost. |
| F07 | SSO opened any adapter-supplied URL | **Fixed** | `app/org-sso.js`: only `https://accounts.google.com/o/oauth2/(v2/)auth`. `app/org-sso.test.js` covers `file:`, look-alike hosts, userinfo, custom schemes. |
| F08 | SSO callback reflected HTML before checking state | **Fixed** | Same module: state checked first, wrong/missing state ignored without ending the sign-in, fixed plain-text replies with `default-src 'none'`. |
| F09 | Provider text in logs and diagnostics | **Fixed** | `src/provider_errors.py`: third-party exceptions reduced to class + HTTP status where caught; own messages keep their wording after a credential scrub. Bedrock/adapter bodies no longer read into errors. Export redactor blanks bearer tokens, API keys, JWTs, key parameters. Tests use real OpenAI/Anthropic SDK exceptions carrying a confidential marker and a key. |
| F10 | Silent fallback to a personal cloud provider after org expiry | **Fixed** | Session loss (expiry, 401, missing session) falls back to local and notifies; an explicit sign-out restores the previous provider. `e2e/specs/org-session-loss.t2.spec.ts`. |

## Bundled artifact check (F01)

Recorded after rebuilding the backend from this branch:

- `dist/stenoai/_internal/certifi/cacert.pem`: see the PR description for
  the version, hash and emSign root check.

## Before sharing with colleagues

- F02 and F03 are the remaining release blockers named by the review. A
  pilot without them should be an explicit, recorded decision.
- Org sign-in: F10 is open, so the pilot should not use it.
- Distribution: local self-signed builds are not notarised; see
  `custom/README.md` and agree the install path with IT.
