# Security remediation status for the colleague pilot

Point-in-time record against the 2026-11-05 security review (F01-F10) and
`SECURITY_REMEDIATION_PLAN.md`. Branch `security/pilot-hardening`.

| ID | Finding | Status | Evidence |
| --- | --- | --- | --- |
| F01 | Compromised emSign root in the bundled CA store | **Fixed in source**; bundle check below | `certifi==2026.10.23` pinned in `requirements.txt`; `tests/test_tls_trust_store.py` fails if "emSign ECC Root CA - G3" returns or certifi drops below 2026.10.19 |
| F02 | Electron 42 outside supported lines | **Open** | Needs a supported major plus packaged-app checks (audio, Keychain, OAuth, PDF). Not done tonight. |
| F03 | FFmpeg 7.1.1 | **Open** | The helper is copied from the official app (`custom/stage-official-binaries.sh`); needs a rebuilt or verified 7.1.5 helper and format checks. |
| F04 | Summarisation key reused after an endpoint change | **Open** | Mitigated in part by F05/F06 (no plain-http or redirect leakage). Origin-bound key storage like `app/openai-asr-key-store.js` still to do. |
| F05 | Bearer token followed redirects | **Fixed** | `src/secure_http.py` refuses every redirect on credentialed urllib calls (adapter chat/stream, Bedrock, Bedrock key test). `tests/test_secure_http.py` drives 301/302/303/307/308 and same-origin redirects against local servers and asserts the second server receives nothing. |
| F06 | Plain http to remote endpoints | **Fixed** | `src/endpoint_policy.py` and `app/endpoint-policy.js`: https, or http only to loopback; no credentials in URLs. Enforced when saved and again when used (legacy values). `tests/test_endpoint_policy.py`, `app/endpoint-policy.test.js`, `e2e/specs/endpoint-security.t2.spec.ts`. LAN Ollama over plain http now needs an HTTPS proxy or an SSH tunnel to localhost. |
| F07 | SSO opened any adapter-supplied URL | **Fixed** | `app/org-sso.js`: only `https://accounts.google.com/o/oauth2/(v2/)auth`. `app/org-sso.test.js` covers `file:`, look-alike hosts, userinfo, custom schemes. |
| F08 | SSO callback reflected HTML before checking state | **Fixed** | Same module: state checked first, wrong/missing state ignored without ending the sign-in, fixed plain-text replies with `default-src 'none'`. |
| F09 | Provider text in logs and diagnostics | **Fixed** | `src/provider_errors.py`: third-party exceptions reduced to class + HTTP status where caught; own messages keep their wording after a credential scrub. Bedrock/adapter bodies no longer read into errors. Export redactor blanks bearer tokens, API keys, JWTs, key parameters. Tests use real OpenAI/Anthropic SDK exceptions carrying a confidential marker and a key. |
| F10 | Silent fallback to a personal cloud provider after org expiry | **Open (policy decision)** | Applies only to organisation sign-in. Decide whether Youwe wants org-only routing; until then, leave org sign-in unused in the pilot. |

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
