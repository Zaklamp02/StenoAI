# Dependency review — 17 October 2026

The colleague build updates Electron to 42.11.15, the Electron packaging tools,
Axios, Vite and Vitest, refreshes compatible transitive dependencies, and removes
unused Puppeteer. Node 24 LTS is the documented build runtime. Electron 42's
explicit `install-electron` step runs during this project's postinstall so a
fresh checkout can also launch Playwright/dev builds.

`npm audit --omit=dev` reports **zero advisories** for shipped JavaScript
packages. CI now checks this runtime dependency set. `npm audit` including build
and test tools reports **16 dependency entries: 0 critical, 5 high, 11 moderate**.
These entries come from three upstream advisories (several entries are parents
of the same affected package):

| Package | Exposure in this checkout | Decision |
| --- | --- | --- |
| `braces` | Tailwind/watch/build glob parsing; deeply nested patterns can exhaust the stack. | No fixed upstream release reported by npm audit. Inputs are repository-controlled build patterns; do not run builds against untrusted source trees. Track the upstream fix. |
| `postcss-selector-parser` | Tailwind's build-time CSS selector parsing; pathological selectors can consume CPU. | A patched major exists, but Tailwind 3 requests the older major. Keep the supported dependency graph for this pilot; revisit with the Tailwind migration instead of forcing an unverified major override. |
| `sprintf-js` | Electron download/packaging dependencies; unbounded precision can consume resources. | No fixed upstream release reported. This app does not feed meeting content or user format strings into this tooling. Track the upstream fix. |

These are remaining upstream build-tool risks, not a claim of a completely
advisory-free dependency tree. The shipped Electron runtime itself was also
updated; a runtime npm audit alone does not assess Chromium vulnerabilities.

Sources: [braces advisory](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm),
[selector parser advisory](https://github.com/advisories/GHSA-rj75-hqrm-r3gf),
[sprintf-js advisory](https://github.com/advisories/GHSA-hp3w-g68c-fv3c), and
[Electron 42 installation change](https://www.electronjs.org/blog/electron-42-0).

Re-run both audits when updating the lockfile; these counts describe this review,
not a permanent security guarantee. Python requirements retain the fork's
compatibility constraints and were verified by a clean install and bundle build;
they are not a fully hashed, transitively locked dependency set.
