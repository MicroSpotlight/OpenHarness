# OpenHarness

English | [简体中文](README.zh-CN.md)

OpenHarness is a native macOS app that packages an open-source AI agent
harness into a dedicated Tauri window. It bundles the published
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

- Native macOS window for the agent Web UI
- Self-contained Node.js and locked agent runtime
- Separate Apple Silicon and Intel release builds
- Automatic loopback port selection to avoid conflicts
- Shared configuration, credentials, sessions, and plugins in `~/.dsh`
- Runtime telemetry disabled by the desktop launcher
- Menu-bar tray residency with show, new-window, and quit actions
- Single-instance lock: a second launch focuses the running instance
- Automatic backend restart with exponential backoff and a native error dialog
  after repeated failures
- Multi-window, multi-session: each window is an independent session
- Windows follow the system dark/light appearance
- Loads `PATH` and `DEEPSEEK_*` variables from the login shell with a bounded
  timeout so Finder launches can find user tools and configured credentials;
  inherited DeepSeek variables take precedence

## Requirements

- macOS 15.0 or later
- Credentials for at least one model provider supported by the bundled runtime

## Install

Download the DMG for your Mac from
[GitHub Releases](https://github.com/MicroSpotlight/OpenHarness/releases):

- `arm64` for Apple Silicon Macs
- `x64` for Intel Macs

Open the DMG, drag **OpenHarness** into **Applications**, and launch it.

## Usage

OpenHarness starts the bundled agent server on an available loopback port and
opens its Web UI in a native window. Configure a model provider in the app,
then use the interface as you would use the upstream `dsh web` command.

The app uses the same `~/.dsh` directory as the upstream command-line tool.
Existing credentials, configuration, sessions, and plugins are therefore
available to both interfaces. Harness-specific usage is documented in the
upstream [user guide](https://github.com/deepseek-ai/deepseek-harness/tree/master/docs/user/guide).

## How It Works

1. Tauri launches the bundled Node.js executable and the published
   `@deepseek-ai/dsh` package with `dsh web --port 0`.
2. The runtime selects an available local port and reports its loopback URL.
3. OpenHarness validates that URL and opens it in a native webview.
4. Closing a window hides it to the menu-bar tray. Quitting from the tray or
   with `Cmd+Q` terminates the bundled runtime process.

The desktop host does not fork or reimplement the upstream Web UI. The runtime
is assembled from the locked npm package by
[`setup-runtime.sh`](setup-runtime.sh), then receives the independent
OpenHarness name, icon, and theme through
[`scripts/brand-runtime.mjs`](scripts/brand-runtime.mjs).

## Build From Source

Install these prerequisites:

- Xcode Command Line Tools
- [Rust](https://www.rust-lang.org/tools/install)
- [Bun](https://bun.sh/)

Then build the app:

```sh
git clone https://github.com/MicroSpotlight/OpenHarness.git
cd OpenHarness
bun install --frozen-lockfile
./setup-runtime.sh
bun run build
```

Build artifacts are written under `src-tauri/target/release/bundle/`.

For local development:

```sh
bun run dev
```

## Repository Layout

```text
.
|-- .github/workflows/     Signed macOS release automation
|-- assets/                OpenHarness icon source
|-- frontend/dist/         Tauri bootstrap page
|-- runtime/               Locked bundled-runtime manifest
|-- scripts/               Runtime branding and signing helpers
|-- src-tauri/             Rust host and Tauri configuration
`-- setup-runtime.sh       Bundled runtime assembler
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

Changes to the runtime or its Web UI should be contributed upstream. Issues and
pull requests for the OpenHarness macOS host are welcome in this repository.

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
