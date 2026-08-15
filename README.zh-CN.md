# DeepSeek Harness macOS 桌面端

[English](README.md) | 简体中文

DeepSeek Harness macOS 桌面端将
[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) Web UI
打包成原生 macOS 应用。应用会在后台启动内置的 `dsh web` 运行时，并通过独立的 Tauri
窗口呈现界面，日常使用无需另行安装 Node.js 或命令行工具。

DeepSeek Harness 目前仍处于开发者预览阶段。桌面端会紧跟上游项目，因此预发布版本可能
包含不兼容变更。

## 功能

- 通过原生 macOS 窗口使用 DeepSeek Harness Web UI
- 内置 Node.js 和 `@deepseek-ai/dsh` 运行时
- 分别提供 Apple Silicon 和 Intel 原生版本
- 自动选择本地端口，避免端口冲突
- 与 DSH 共用 `~/.dsh` 中的配置、凭据、会话和插件
- 桌面启动器默认关闭内置 DSH 的遥测

## 系统要求

- macOS 15.0 或更高版本
- 至少一个 DeepSeek Harness 支持的模型服务商凭据

## 安装

从 [GitHub Releases](https://github.com/MicroSpotlight/deepseek-desktop/releases)
下载适合当前 Mac 的 DMG：

- Apple Silicon Mac 选择 `arm64`
- Intel Mac 选择 `x64`

打开 DMG，将 **DeepSeek Harness** 拖入 **Applications（应用程序）** 后启动。

## 使用

应用启动时会在可用的本机回环端口上运行内置 DeepSeek Harness 服务，并自动打开其
Web UI。可以像使用 `dsh web` 一样，在原生窗口中配置模型服务商并使用 Harness。

桌面端与 DSH 命令行共用 `~/.dsh` 目录，因此已有的凭据、配置、会话和插件可在两种
入口之间直接复用。Harness 本身的使用方式请参考上游
[DeepSeek Harness 用户指南](https://github.com/deepseek-ai/deepseek-harness/tree/master/docs/user/guide)。

## 工作原理

1. Tauri 使用内置 Node.js 和官方 `@deepseek-ai/dsh` 包启动
   `dsh web --port 0`。
2. DSH 自动选择可用的本地端口，并输出对应的回环地址。
3. 应用在原生 webview 中打开该地址。
4. 退出应用时，同时终止内置 DSH 进程。

桌面宿主不会复刻或重新实现 Harness UI。运行时由
[`setup-runtime.sh`](setup-runtime.sh) 从已发布的 `@deepseek-ai/dsh` npm 包组装。

## 开发

### 环境要求

- macOS
- Xcode Command Line Tools
- [Rust](https://www.rust-lang.org/tools/install)
- [Bun](https://bun.sh/)

### 从源码构建

```sh
git clone https://github.com/MicroSpotlight/deepseek-desktop.git
cd deepseek-desktop
bun install
./setup-runtime.sh
bun run build
```

构建产物位于 `src-tauri/target/release/bundle/`。

本地开发：

```sh
bun run dev
```

### 仓库结构

```text
.
├── assets/                 应用图标源文件
├── frontend/dist/          Tauri 启动占位页
├── scripts/                项目辅助脚本
├── src-tauri/              Rust 宿主与 Tauri 配置
└── setup-runtime.sh        内置 DSH 运行时组装脚本
```

`src-tauri/runtime/` 由脚本在本地生成，不纳入 Git。

## 隐私

桌面宿主不增加遥测，并在启动内置 DSH 时明确关闭其遥测。提示词、附件和模型请求仍会发送
给用户主动配置的模型服务商；DSH 本地数据继续保存在 `~/.dsh`。

## 参与贡献

欢迎提交 Issue 和 Pull Request。涉及 Harness 行为或 Web UI 的改动，请提交到
[DeepSeek Harness 上游仓库](https://github.com/deepseek-ai/deepseek-harness)。

## 许可证与上游归属

本仓库原创的桌面封装代码采用 [Apache License 2.0](LICENSE) 许可。

本应用内置的 [`@deepseek-ai/dsh`](https://www.npmjs.com/package/@deepseek-ai/dsh)
来自 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)，采用
[MIT License](https://github.com/deepseek-ai/deepseek-harness/blob/master/LICENSE)：

> Copyright (c) 2026 DeepSeek

上游 MIT 许可证全文会随 npm 包保留，并进入最终应用包。其他内置依赖仍分别遵循各自的
许可证。
