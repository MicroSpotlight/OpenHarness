# OpenHarness Plugin Installation Audit

Date: 2026-08-18

## Scope

- Catalog revision: `c38e07c3b24c3abcf00ddca9350dc39494fb1e55`
- Catalog generated at: `2026-08-18T10:11:21.014Z`
- Catalog size: 241 plugins
- Audited sample: first 20 catalog entries, in catalog order
- Runtime: OpenHarness managed host, DSH `0.1.0-rc.7`, bundled Node `v24.19.0`
- Host: macOS x64

Each plugin was installed into an isolated `web` profile. A failed installation
was allowed to roll back and was then retried once. A package operation counted
as successful only after the updated profile started with the same OpenHarness
patches and emitted a valid loopback Web URL. After each sample, profile
metadata and dependencies were reset before testing the next plugin.

This is an installation and startup compatibility audit. It does not claim
that every feature or external service of a successfully started plugin was
manually exercised.

## Result Summary

- 15 plugins installed and passed the startup probe.
- 4 plugins failed reproducibly because their package or onboarding contract is
  not compatible with unattended one-click installation.
- 1 plugin correctly declares a different profile and is now rejected before
  mutation.
- All 20 samples preserved the pre-install `package.json`, lockfile,
  `pnpm-workspace.yaml`, and Cordis patch after cleanup or rollback.
- The managed DSH backend remained available throughout the final audit.

## Results

| # | Plugin | Version | Result | Classification |
|---:|---|---:|---|---|
| 1 | `aegis` | 2.8.2 | Passed | Compatible |
| 2 | `agentrq-dsh` | 0.2.5 | Failed twice, rolled back | Plugin configuration |
| 3 | `allinflash` | 0.2.0 | Passed | Compatible |
| 4 | `anysearch-dsh` | 0.1.1 | Passed | Compatible |
| 5 | `archify-dsh` | 0.1.0 | Passed | Compatible |
| 6 | `captain1275-dsh-pet` | 0.2.7 | Passed | Compatible |
| 7 | `captain1275-dsh-web-ui-all` | 0.2.8 | Failed twice, rolled back | Plugin packaging |
| 8 | `config` | 0.1.5 | Passed | Compatible |
| 9 | `deepseek-flow` | 0.4.0 | Passed | Compatible |
| 10 | `deepseek-harness-auth` | 0.4.1 | Failed twice, rolled back | Plugin onboarding |
| 11 | `deepseek-harness-tui` | 0.2.5 | Rejected twice before mutation | OpenHarness guard fixed |
| 12 | `deepseek-harness-wallet` | 0.1.5 | Passed | Compatible |
| 13 | `deepseek-harness-zh-pro` | 0.6.1 | Passed | Compatible |
| 14 | `deepseek-idesign` | 0.2.2 | Passed | Compatible |
| 15 | `deepseek-ippt` | 0.1.2 | Passed | Compatible |
| 16 | `deepseek-pet` | 0.1.0 | Passed | Compatible |
| 17 | `deepseek-plugin-store` | 0.3.0 | Passed | Compatible |
| 18 | `dockyard-dsh` | 0.1.1 | Failed twice, rolled back | Plugin packaging |
| 19 | `dsh-ads` | 0.1.0 | Passed | Compatible |
| 20 | `dsh-advisor` | 0.2.2 | Passed | Compatible |

## OpenHarness Findings And Fixes

### OH-1: Installation did not prove that the updated profile could start

Severity: Critical

The installer previously treated package installation and static profile
composition as sufficient. `agentrq-dsh` demonstrated the failure mode: the
operation completed, but the next App restart failed because the plugin's
required `url` configuration was absent.

Fix: after `plugin add` succeeds, the managed runtime now starts the updated
profile with the actual OpenHarness patches and a random port. It accepts the
installation only after DSH emits a valid loopback URL. A failed or timed-out
probe is returned to the existing rollback transaction instead of restarting
the App into a broken profile.

### OH-2: Rollback omitted pnpm workspace policy state

Severity: High

DSH/pnpm can modify `pnpm-workspace.yaml` while evaluating build scripts and
minimum-release-age policy. The original Find Plugin snapshot omitted this
file. Rollback could therefore remove the failed package while leaving policy
changes behind. It could also generate a new lockfile while reinstalling the
old dependency set.

Fix: the bundled Find Plugin integration now snapshots
`pnpm-workspace.yaml`. After dependency restoration succeeds, it restores the
metadata snapshot a second time so all four transaction files exactly match
their pre-install state.

### OH-3: Profile compatibility was trusted to the UI

Severity: High

`deepseek-harness-tui` declares only the `dsh-tui` profile, but the Host API
previously accepted an installation request for `web`. The package then made
the Web profile exit during startup.

Fix: the Host now enforces `plugin.compatibility.profiles` before any profile
mutation and returns `409 PROFILE_INCOMPATIBLE`. This is a server-side guard;
it remains effective if a caller bypasses UI controls.

### OH-4: Package manager diagnostics were hidden

Severity: Medium

DSH writes the pnpm failure summary to stderr but detailed pnpm diagnostics to
stdout. The operation returned only stderr, leaving users with a generic
`pnpm failed` message.

Fix: failed operations now combine bounded stderr and stdout. The Plugin Center
can display the exact ignored-build packages without exposing unbounded output.

## Plugin Or Catalog Issues

### `agentrq-dsh@0.2.5`

Reproduction: package installation succeeds, but DSH fails while loading the
`agentrq` entry because `$.url` is required and no value is supplied.

Author action: provide a safe disabled/default configuration, or declare and
implement a required post-install configuration flow before the bundle becomes
active.

### `@captain1275/dsh-web-ui-all@0.2.8`

Reproduction: pnpm reports `ERR_PNPM_IGNORED_BUILDS` for
`cpu-features@0.0.10` and `ssh2@1.17.0`.

Author/catalog action: publish an artifact that does not require unapproved
dependency build scripts, or add a reviewed, exact build-policy contract to the
catalog and installer. OpenHarness must not approve arbitrary scripts
automatically.

### `deepseek-harness-auth@0.4.1`

Reproduction: the package installs, then the profile does not expose the normal
Harness readiness URL within 30 seconds. The plugin intentionally suppresses
that URL and requires interactive `dsh-auth init` account setup before normal
use.

Author/catalog action: provide a non-interactive safe initial state plus an
in-App onboarding contract, or mark the plugin as unavailable for one-click
OpenHarness installation until that flow exists.

### `dockyard-dsh@0.1.1`

Reproduction: the Git dependency is pinned correctly, but pnpm reports
`ERR_PNPM_IGNORED_BUILDS` for `@google/genai@1.52.0` and
`protobufjs@7.6.5`. Git-hosted installation also requires a prepare build.

Author/catalog action: publish a prebuilt npm package, or provide a reviewed,
exact build-policy contract. OpenHarness must not silently enable Git prepare
or transitive dependency scripts.

## Acceptance Evidence

- Every reproducible failure occurred twice with the same classification.
- Every failed or rejected sample ended with an exact profile metadata match.
- No failed package remained in the isolated profile dependency or bundle list.
- The final isolated profile contained no third-party dependency and the
  Plugin Center Host API remained responsive.
- Managed runtime tests and native Host tests cover the new startup and runtime
  environment contracts.
