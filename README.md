# DeepSeek Harness for macOS

English | [简体中文](README.zh-CN.md)

DeepSeek Harness for macOS packages the [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)
Web UI as a native macOS application. It starts a bundled `dsh web` runtime in
the background and presents it in a dedicated Tauri window, so no separate
Node.js or command-line installation is required for normal use.

DeepSeek Harness is currently a developer preview. The desktop app follows the
upstream project closely, so prerelease versions may include breaking changes.

## Features

- Native macOS window for the DeepSeek Harness Web UI
- Self-contained Node.js and `@deepseek-ai/dsh` runtime
- Native builds for Apple Silicon and Intel Macs
- Automatic local port selection to avoid conflicts
- Shared DSH configuration, credentials, sessions, and plugins in `~/.dsh`
- Bundled DSH telemetry disabled by the desktop launcher

## Requirements

- macOS 15.0 or later
- Credentials for at least one model provider supported by DeepSeek Harness

## Install

Download the DMG for your Mac from
[GitHub Releases](https://github.com/MicroSpotlight/deepseek-desktop/releases):

- `arm64` for Apple Silicon Macs
- `x64` for Intel Macs

Open the DMG, drag **DeepSeek Harness** into **Applications**, and launch it.

## Usage

On launch, the app starts the bundled DeepSeek Harness server on an available
loopback port and opens its Web UI. Configure providers and use Harness from the
native window as you would from `dsh web`.

The app uses the same `~/.dsh` directory as the DSH command-line interface.
Existing credentials, configuration, sessions, and plugins are therefore
available to both interfaces. See the upstream
[DeepSeek Harness user guide](https://github.com/deepseek-ai/deepseek-harness/tree/master/docs/user/guide)
for Harness-specific usage.

## How It Works

1. Tauri launches the bundled Node.js executable and the official
   `@deepseek-ai/dsh` package with `dsh web --port 0`.
2. DSH selects an available local port and reports its loopback URL.
3. The app opens that URL in a native webview.
4. Closing the app also terminates the bundled DSH process.

The desktop host does not fork or reimplement the Harness UI. The runtime is
assembled from the published `@deepseek-ai/dsh` npm package by
[`setup-runtime.sh`](setup-runtime.sh).

## Development

### Prerequisites

- macOS
- Xcode Command Line Tools
- [Rust](https://www.rust-lang.org/tools/install)
- [Bun](https://bun.sh/)

### Build From Source

```sh
git clone https://github.com/MicroSpotlight/deepseek-desktop.git
cd deepseek-desktop
bun install
./setup-runtime.sh
bun run build
```

Build artifacts are written under `src-tauri/target/release/bundle/`.

For local development:

```sh
bun run dev
```

### Repository Layout

```text
.
├── assets/                 App icon sources
├── frontend/dist/          Tauri bootstrap page
├── scripts/                Project helper scripts
├── src-tauri/              Rust host and Tauri configuration
└── setup-runtime.sh        Bundled DSH runtime assembler
```

`src-tauri/runtime/` is generated locally and excluded from Git.

## Privacy

The desktop host does not add telemetry and launches the bundled DSH runtime
with telemetry disabled. Prompts, attachments, and model requests are still
sent to the model providers that the user configures. Local DSH data remains in
`~/.dsh`.

## Contributing

Issues and pull requests are welcome. For changes that affect Harness behavior
or its Web UI, contribute to the
[upstream DeepSeek Harness repository](https://github.com/deepseek-ai/deepseek-harness).

## License and Upstream Attribution

The original desktop wrapper code in this repository is licensed under the
[Apache License 2.0](LICENSE).

This application bundles
[`@deepseek-ai/dsh`](https://www.npmjs.com/package/@deepseek-ai/dsh), published
from [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) under
the [MIT License](https://github.com/deepseek-ai/deepseek-harness/blob/master/LICENSE):

> Copyright (c) 2026 DeepSeek

The upstream MIT license text is retained in the npm package and in the
resulting application bundle. Other bundled dependencies remain subject to
their respective licenses.
