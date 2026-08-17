# OpenHarness

[English](README.md) | 简体中文

OpenHarness 是一个支持 macOS、Windows 和 Linux 的原生 AI Agent 桌面应用。它将
开源 Agent Harness 的 Web UI 和已发布的
[`@deepseek-ai/dsh`](https://www.npmjs.com/package/@deepseek-ai/dsh) 运行时打包进
独立的 Tauri 应用，日常使用无需另行安装 Node.js 或命令行工具。

OpenHarness 由 MicroSpotlight 独立开发。为避免与 DeepSeek 品牌产生混淆、防止用户将
本应用误认为 DeepSeek 官方产品，并降低商标与著作权方面的侵权风险，本项目重新定义了
独立的产品名称、应用图标、Bundle ID、桌面宿主标识和视觉主题，不继承上游项目的品牌
素材，也不暗示本项目获得 DeepSeek 的官方认可或与其存在隶属关系。

## 功能

- 通过 macOS、Windows 和 Linux 原生桌面窗口使用 Agent Web UI
- 内置 Node.js 和锁定版本的 Agent 运行时
- 为 macOS、Windows 和 Linux 提供 arm64/x64 原生安装包
- 自动选择本机回环端口，避免端口冲突
- 与上游工具共用 `~/.dsh` 中的配置、凭据、会话和插件
- 桌面启动器默认关闭内置运行时的遥测
- 系统托盘常驻：顶层展示 5 个优先会话，「更多会话」展示 20 个最近会话并可查看全部
- 单实例锁：重复启动会聚焦已运行实例
- 后端崩溃自动重启（指数退避），连续失败弹原生错误提示窗
- 单业务窗口：选择或新建会话时复用并聚焦主窗口
- 窗口和原生菜单跟随应用的深色/浅色外观与语言设置
- macOS 和 Linux 启动时限时从登录 shell 加载 `PATH` 和 `DEEPSEEK_API_KEY` 等
  `DEEPSEEK_*` 环境变量注入后端（从桌面启动也能找到用户工具和 token；已继承的
  DeepSeek 环境变量优先）

## 系统要求

- macOS 15.0 或更高版本（Apple Silicon 或 Intel）
- Windows 10 1709 或更高版本（x64 或 arm64），并安装 Microsoft Edge WebView2
  Runtime；推荐使用 Windows 11
- Linux x64 或 arm64，kernel 4.18+、glibc 2.35+、WebKitGTK 4.1；支持基线为
  Ubuntu 22.04+ 和 Debian 12+
- 至少一个内置运行时支持的模型服务商凭据

## 安装

### Homebrew（macOS）

通过 [MicroSpotlight Homebrew Tap](https://github.com/MicroSpotlight/homebrew-tap)
安装：

```sh
brew install --cask microspotlight/tap/openharness
```

Cask 会根据当前 Mac 自动选择 Apple Silicon 或 Intel 版本。

### 直接下载

从 [GitHub Releases](https://github.com/MicroSpotlight/OpenHarness/releases)
下载对应平台的安装包：

- macOS Apple Silicon：`OpenHarness_<版本>_arm64.dmg`
- macOS Intel：`OpenHarness_<版本>_x64.dmg`
- Windows x64：`OpenHarness_<版本>_x64-setup.exe`
- Windows arm64：`OpenHarness_<版本>_arm64-setup.exe`
- Linux x64：`OpenHarness_<版本>_amd64.AppImage` 或
  `OpenHarness_<版本>_amd64.deb`
- Linux arm64：`OpenHarness_<版本>_arm64.AppImage` 或
  `OpenHarness_<版本>_arm64.deb`

macOS 打开 DMG 后将 **OpenHarness** 拖入 **Applications（应用程序）**；Windows
运行 NSIS 安装器；Linux 可安装 Debian 包，或为 AppImage 添加执行权限后直接启动。

macOS 安装包已使用 Developer ID 签名并完成公证。Windows 安装器当前尚未进行
Authenticode 签名，因此系统可能显示发布者警告。

## 使用

OpenHarness 会在可用的本机回环端口上启动内置 Agent 服务，并在原生窗口中打开 Web UI。
在应用中配置模型服务商后，即可像使用上游 `dsh web` 命令一样使用该界面。

应用与上游命令行工具共用 `~/.dsh` 目录，因此已有的凭据、配置、会话和插件可以在两种
入口之间直接复用。Harness 本身的使用方式请参考上游
[用户指南](https://github.com/deepseek-ai/deepseek-harness/tree/master/docs/user/guide)。

## 工作原理

1. Tauri 使用内置 Node.js、已发布的 `@deepseek-ai/dsh` 包和随应用打包的
   OpenHarness 桥接补丁启动服务，并自动选择端口。
2. 运行时自动选择可用的本机端口，并输出对应的回环地址。
3. OpenHarness 校验该地址后，在原生 webview 中打开它。
4. 关闭窗口时将其隐藏到系统托盘；从应用菜单或托盘选择「退出」时，终止内置运行时进程。

桌面宿主不会复刻或重新实现上游 Web UI。运行时由
[`scripts/setup-runtime.mjs`](scripts/setup-runtime.mjs) 按锁文件组装，再通过
[`scripts/brand-runtime.mjs`](scripts/brand-runtime.mjs) 应用 OpenHarness 独立的
名称、图标和主题。

## 从源码构建

请先安装 [Rust](https://www.rust-lang.org/tools/install)、[Bun](https://bun.sh/)
以及对应平台的原生工具链：

- macOS：Xcode Command Line Tools
- Windows：包含 C++ 工作负载的 Visual Studio Build Tools 和 WebView2
- Linux：WebKitGTK 4.1 及其他
  [Tauri Linux 前置依赖](https://v2.tauri.app/start/prerequisites/#linux)

然后执行：

```sh
git clone https://github.com/MicroSpotlight/OpenHarness.git
cd OpenHarness
bun install --frozen-lockfile
bun run build
```

`bun install` 会通过 `postinstall` 自动组装内置运行时；需要手动校验或重建时，
执行 `bun run setup:runtime`。

构建产物位于 `src-tauri/target/release/bundle/`。

本地开发：

```sh
bun run dev
```

## 仓库结构

```text
.
|-- .github/workflows/     跨平台发版与 Pages 自动化
|-- assets/                OpenHarness 图标源文件
|-- frontend/dist/         Tauri 启动占位页
|-- runtime/               锁定的内置运行时清单
|-- scripts/               运行时组装、品牌、发版与签名脚本
`-- src-tauri/             Rust 宿主与 Tauri 配置
```

`src-tauri/runtime/` 由脚本在本地生成，不纳入 Git。

## 隐私

OpenHarness 的桌面宿主不增加遥测，并会明确关闭内置运行时的遥测。提示词、附件和模型请求
仍会发送给用户主动配置的模型服务商；本地 Harness 数据继续保存在 `~/.dsh`。

## 与上游项目的关系

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 是
OpenHarness 内置的上游运行时组件。该上游组件单独采用 MIT License；OpenHarness 原创代码
仍采用 Apache License 2.0。本仓库中对 DeepSeek Harness 的引用仅用于说明和归属该依赖。
为避免与上游项目及其品牌产生混淆，OpenHarness 使用完全独立的产品标识。

## 参与贡献

涉及运行时或 Web UI 的改动应提交到上游仓库；OpenHarness 桌面宿主相关的 Issue 和
Pull Request 欢迎提交到本仓库。

## 版权与许可证

Copyright 2026 MicroSpotlight.

- OpenHarness 原创桌面宿主代码：[Apache License 2.0](LICENSE)
- 内置的上游 `@deepseek-ai/dsh` 组件：
  [MIT License](https://github.com/deepseek-ai/deepseek-harness/blob/master/LICENSE)

以下版权声明仅适用于内置的上游组件：

> Copyright (c) 2026 DeepSeek

上游 MIT 许可证全文会随 npm 包保留，并进入最终应用包。其他内置依赖仍分别遵循各自的
许可证。归属信息请参阅 [NOTICE](NOTICE)。
