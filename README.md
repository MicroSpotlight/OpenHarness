# OpenHarness

English | [简体中文](README.zh-CN.md)

OpenHarness is a native macOS desktop app for an open-source AI agent harness.
It packages the [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)
Web UI and runtime inside a dedicated Tauri application, so normal use does not
require a separate Node.js or command-line installation.

OpenHarness is independently developed by MicroSpotlight. To avoid confusion
with the DeepSeek brand, prevent the app from being mistaken for an official
DeepSeek product, and reduce trademark and copyright risk, this project defines
its own product name, application icon, Bundle ID, and desktop host identity.
It does not adopt the upstream project's brand assets or imply endorsement by
or affiliation with DeepSeek.

## Features

- Native macOS window for the AI agent Web UI
- Self-contained Node.js and agent runtime
- Automatic local port selection to avoid conflicts
- Shared upstream configuration, credentials, sessions, and plugins in `~/.dsh`
- Bundled runtime telemetry disabled by the desktop launcher
- Menu-bar tray residency: closing a window hides to the tray (show / new window / quit)
- Single-instance lock: a second launch focuses the running instance
- Automatic backend restart with exponential backoff, plus a native error dialog after repeated failures
- Multi-window, multi-session: each window is an independent session
- Windows follow the system dark/light appearance
- Loads `DEEPSEEK_*` environment variables (e.g. `DEEPSEEK_API_KEY`) from the login shell at startup, so Finder launches still find the token; inherited environment takes precedence

## Requirements

- macOS 15.0 or later
- Credentials for at least one model provider supported by the bundled harness

## Build From Source

Install the following prerequisites:

- Xcode Command Line Tools
- [Rust](https://www.rust-lang.org/tools/install)
- [Bun](https://bun.sh/)

Then build the application:

```sh
bun install
./setup-runtime.sh
bun run build
```

Build artifacts are written under `src-tauri/target/release/bundle/`.

For local development:

```sh
bun run dev
```

## Usage

OpenHarness starts the bundled agent server on an available loopback port and
opens its Web UI in a native window. Configure a model provider in the app,
then use the interface as you would use the upstream `dsh web` command.

The app uses the same `~/.dsh` directory as the upstream command-line tool.
Existing credentials, configuration, sessions, and plugins are therefore
available to both interfaces. See the upstream
[user guide](https://github.com/deepseek-ai/deepseek-harness/tree/master/docs/user/guide)
for harness-specific usage.

## How It Works

1. Tauri launches the bundled Node.js executable and the published
   `@deepseek-ai/dsh` package with `dsh web --port 0`.
2. The runtime selects an available local port and reports its loopback URL.
3. OpenHarness opens that URL in a native webview.
4. Closing OpenHarness also terminates the bundled runtime process.

The desktop host does not fork or reimplement the upstream Web UI. The runtime
is assembled from the published npm package by
[`setup-runtime.sh`](setup-runtime.sh).

## Repository Layout

```text
.
|-- assets/                 OpenHarness icon source
|-- frontend/dist/          Tauri bootstrap page
|-- runtime/                Pinned bundled-runtime manifest and lockfile
|-- scripts/                Runtime branding patch
|-- src-tauri/              Rust host and Tauri configuration
`-- setup-runtime.sh        Bundled runtime assembler
```

`src-tauri/runtime/` is generated locally and excluded from Git.

## Privacy

The desktop host used by OpenHarness does not add telemetry and launches the bundled
runtime with telemetry disabled. Prompts, attachments, and model requests are
still sent to the model providers configured by the user. Local harness data
remains in `~/.dsh`.

## Contributing

Issues and pull requests for the desktop host in OpenHarness are welcome. Changes
to the underlying agent runtime or its Web UI should be contributed to the
[upstream repository](https://github.com/deepseek-ai/deepseek-harness).

## Copyright and Licenses

Copyright 2026 MicroSpotlight.

The original desktop host code in OpenHarness is licensed under the
[Apache License 2.0](LICENSE).

This application bundles
[`@deepseek-ai/dsh`](https://www.npmjs.com/package/@deepseek-ai/dsh), published
from [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) under
the [MIT License](https://github.com/deepseek-ai/deepseek-harness/blob/master/LICENSE):

> Copyright (c) 2026 DeepSeek

The upstream MIT license text is retained in the npm package and in the
resulting application bundle. Other bundled dependencies remain subject to
their respective licenses. See [NOTICE](NOTICE) for attribution details.
