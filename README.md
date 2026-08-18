# OpenHarness

English | [简体中文](README.zh-CN.md)

OpenHarness is a native desktop app for macOS, Windows, and Linux that packages
an open-source AI agent harness into a dedicated Tauri window. It bundles the
published
[`@deepseek-ai/dsh`](https://www.npmjs.com/package/@deepseek-ai/dsh) runtime and
Web UI, so normal use does not require a separate Node.js or command-line
installation.

OpenHarness is independently developed by MicroSpotlight. To avoid confusion
with the DeepSeek brand, prevent the app from being mistaken for an official
DeepSeek product, and reduce trademark and copyright infringement risk, this
project defines its own product name, application icon, Bundle ID, desktop host
identity, and visual theme. It does not adopt the upstream project's brand
assets or imply endorsement by or affiliation with DeepSeek.

## Features

- Native desktop window for the agent Web UI on macOS, Windows, and Linux
- Self-contained Node.js and locked agent runtime
- Native installers for macOS, Windows, and Linux on arm64 and x64
- Automatic loopback port selection to avoid conflicts
- Shared configuration, credentials, sessions, and plugins in `~/.dsh`
- Built-in plugin discovery under **Settings → Plugins**, with catalog search,
  category filters, installed-state detection, and upgrade availability
- In-app plugin installation and upgrades pinned to an exact package version or
  Git commit, with cancellation, rollback, post-install verification, and
  managed restart when activation requires it
- Bundled pnpm execution environment; plugin management does not depend on a
  system Node.js or pnpm installation
- Runtime telemetry disabled by the desktop launcher
- Live system-tray session menu: five prioritized tasks, 20 more recent
  sessions, and a link to the complete list in Harness
- Single-instance lock: a second launch focuses the running instance
- Automatic backend restart with exponential backoff and a native error dialog
  after repeated failures
- One business window; selecting or creating a session reuses and focuses it
- The window and native menus follow the configured dark/light appearance and locale
- On macOS and Linux, loads `PATH` and `DEEPSEEK_*` variables from the login
  shell with a bounded timeout so desktop launches can find user tools and
  configured credentials; inherited DeepSeek variables take precedence

## Requirements

- macOS 15.0 or later (Apple Silicon or Intel)
- Windows 10 1709 or later on x64 or arm64 with the Microsoft Edge WebView2
  Runtime; Windows 11 is recommended
- Linux x64 or arm64 with kernel 4.18+, glibc 2.35+, and WebKitGTK 4.1;
  Ubuntu 22.04+ and Debian 12+ are the supported baselines
- Credentials for at least one model provider supported by the bundled runtime

## Install

### Homebrew (macOS)

Install from the [MicroSpotlight Homebrew tap](https://github.com/MicroSpotlight/homebrew-tap):

```sh
brew install --cask microspotlight/tap/openharness
```

The cask automatically selects the Apple Silicon or Intel build for the current
Mac.

### Direct downloads

Download the package for your platform from
[GitHub Releases](https://github.com/MicroSpotlight/OpenHarness/releases):

- macOS Apple Silicon: `OpenHarness_<version>_arm64.dmg`
- macOS Intel: `OpenHarness_<version>_x64.dmg`
- Windows x64: `OpenHarness_<version>_x64-setup.exe`
- Windows arm64: `OpenHarness_<version>_arm64-setup.exe`
- Linux x64: `OpenHarness_<version>_amd64.AppImage` or
  `OpenHarness_<version>_amd64.deb` or `OpenHarness_<version>_amd64.rpm`
- Linux arm64: `OpenHarness_<version>_arm64.AppImage` or
  `OpenHarness_<version>_arm64.deb` or `OpenHarness_<version>_arm64.rpm`

On macOS, open the DMG and drag **OpenHarness** into **Applications**. On
Windows, run the NSIS installer. On Linux, install the Debian or RPM package,
or mark the AppImage executable and launch it.

macOS releases are Developer ID signed and notarized. The Windows installer is
currently not Authenticode-signed, so Windows may show a publisher warning.

## Usage

OpenHarness starts the bundled agent server on an available loopback port and
opens its Web UI in a native window. Configure a model provider in the app,
then use the interface as you would use the upstream `dsh web` command.

The app uses the same `~/.dsh` directory as the upstream command-line tool.
Existing credentials, configuration, sessions, and plugins are therefore
available to both interfaces. Harness-specific usage is documented in the
upstream [user guide](https://github.com/deepseek-ai/deepseek-harness/tree/master/docs/user/guide).

## Plugins

Open **Settings → Plugins → Discover** to search the OpenHarness plugin catalog,
filter by category or capability, inspect publisher and compatibility details,
and install or upgrade a plugin without leaving the app. OpenHarness reports
installed, upgrade-available, newer-installed, conflict, and restart-required
states instead of guessing from a display name.

Plugin changes are performed against the `web` profile under `~/.dsh`. The
browser submits only a plugin name, action, catalog version, and catalog
revision. The bundled Find Plugin Host reloads and validates the catalog,
derives an exact npm version or Git commit, snapshots the profile, runs the
operation, verifies the installed package, and rolls metadata back if the
operation fails. Operations can be cancelled and are restored in the UI after
a page refresh.

OpenHarness does not implement catalog or installation policy in Rust. The
desktop app exposes a Cordis managed-runtime service backed by its bundled
Node.js, DSH, and pnpm environment. That service provides bounded output,
timeouts, one active package operation, full process-tree cancellation, and a
supervisor-managed backend restart. The Find Plugin owns catalog trust,
installation intent, installed-state matching, rollback, and activation.

Browse the read-only
[OpenHarness Plugin Marketplace](https://microspotlight.github.io/openharness-plugins/)
to search the public catalog. Installation and upgrades remain in the app. The
catalog and discovery components are maintained in the
[`openharness-plugins`](https://github.com/MicroSpotlight/openharness-plugins)
and
[`openharness-find-plugin`](https://github.com/MicroSpotlight/openharness-find-plugin)
repositories.

## How It Works

1. Tauri launches the bundled Node.js executable and the published
   `@deepseek-ai/dsh` package with the OpenHarness Native Bridge, Find Plugin,
   and an automatically selected port.
2. The runtime selects an available local port and reports its loopback URL.
3. OpenHarness validates that URL and opens it in a native webview.
4. The Native Bridge registers the managed plugin runtime for the current
   `web` profile and gives package operations the bundled pnpm environment.
5. A plugin-requested restart exits the DSH child with the managed restart code;
   the OpenHarness supervisor immediately starts a fresh backend generation.
6. Closing the window hides it to the system tray. Quitting from the app menu
   or tray terminates the bundled runtime process.

The desktop host does not fork or reimplement the upstream Web UI. The runtime
is assembled from the locked npm package by
[`scripts/setup-runtime.mjs`](scripts/setup-runtime.mjs), then receives the independent
OpenHarness name, icon, and theme through
[`scripts/brand-runtime.mjs`](scripts/brand-runtime.mjs).

## Build From Source

Install [Rust](https://www.rust-lang.org/tools/install), [Bun](https://bun.sh/),
and the native toolchain for your platform:

- macOS: Xcode Command Line Tools
- Windows: Visual Studio Build Tools with the C++ workload and WebView2
- Linux: WebKitGTK 4.1 and the other
  [Tauri Linux prerequisites](https://v2.tauri.app/start/prerequisites/#linux)

Then build the app:

```sh
git clone https://github.com/MicroSpotlight/OpenHarness.git
cd OpenHarness
bun install --frozen-lockfile
bun run build
```

`bun install` assembles the bundled runtime through `postinstall`. Run
`bun run setup:runtime` to validate or rebuild it manually.

Build artifacts are written under `src-tauri/target/release/bundle/`.

For local development:

```sh
bun run dev
```

## Repository Layout

```text
.
|-- .github/workflows/     Cross-platform release and Pages automation
|-- assets/                OpenHarness icon source
|-- frontend/dist/         Tauri bootstrap page
|-- runtime/               Locked runtime, Native Bridge, Find Plugin, and pnpm launcher
|-- scripts/               Runtime assembly, branding, release, and signing helpers
`-- src-tauri/             Rust host and Tauri configuration
```

`src-tauri/runtime/` is generated locally and excluded from Git.

## Privacy

The OpenHarness desktop host does not add telemetry and explicitly disables
telemetry in the bundled runtime. Prompts, attachments, and model requests are
still sent to model providers configured by the user. Local harness data
remains in `~/.dsh`.

## Upstream Relationship

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) is the
upstream runtime component bundled by OpenHarness. That upstream component is
distributed separately under the MIT License; OpenHarness's original code
remains licensed under Apache License 2.0. References to DeepSeek Harness in
this repository are limited to describing and attributing that dependency.
OpenHarness uses its own product identity to avoid confusion with the upstream
project and its brand.

## Contributing

Changes to the upstream runtime or its Web UI should be contributed upstream.
Catalog entries belong in `openharness-plugins`, discovery and installation
orchestration belong in `openharness-find-plugin`, and desktop managed-runtime
or supervisor changes belong in this repository.

## Copyright and Licenses

Copyright 2026 MicroSpotlight.

- Original OpenHarness desktop host code: [Apache License 2.0](LICENSE)
- Bundled upstream `@deepseek-ai/dsh` component:
  [MIT License](https://github.com/deepseek-ai/deepseek-harness/blob/master/LICENSE)

The following copyright notice applies to the bundled upstream component:

> Copyright (c) 2026 DeepSeek

The upstream MIT license text is retained in the npm package and final app
bundle. Other bundled dependencies remain subject to their respective
licenses. See [NOTICE](NOTICE) for attribution details.
