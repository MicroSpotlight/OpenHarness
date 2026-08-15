# OpenHarness

[English](README.md) | 简体中文

OpenHarness 是一个原生 macOS AI Agent 桌面应用。它将
[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的 Web UI
和运行时打包进独立的 Tauri 应用，日常使用无需另行安装 Node.js 或命令行工具。

OpenHarness 由 MicroSpotlight 独立开发。为避免与 DeepSeek 品牌产生混淆、防止用户将
本应用误认为 DeepSeek 官方产品，并降低商标与著作权方面的侵权风险，本项目重新定义了
独立的产品名称、应用图标、Bundle ID 和桌面宿主标识，不继承上游项目的品牌素材，
也不暗示本项目获得 DeepSeek 的官方认可或与其存在隶属关系。

## 功能

- 通过原生 macOS 窗口使用 AI Agent Web UI
- 内置 Node.js 和 Agent 运行时
- 自动选择本地端口，避免端口冲突
- 与上游工具共用 `~/.dsh` 中的配置、凭据、会话和插件
- 桌面启动器默认关闭内置运行时的遥测
- 系统托盘常驻：关闭窗口隐藏到菜单栏，托盘可「显示主窗口 / 新建窗口 / 退出」
- 单实例锁：重复启动会聚焦已运行实例
- 后端崩溃自动重启（指数退避），连续失败弹原生错误提示窗
- 多窗口多会话：每个窗口对应一个独立会话
- 窗口跟随系统深色/浅色外观
- 启动时从登录 shell 加载 `DEEPSEEK_API_KEY` 等 `DEEPSEEK_*` 环境变量注入后端（Finder 启动也能拿到 token；已继承的环境变量优先）

## 系统要求

- macOS 15.0 或更高版本
- 至少一个内置 Harness 支持的模型服务商凭据

## 从源码构建

请先安装：

- Xcode Command Line Tools
- [Rust](https://www.rust-lang.org/tools/install)
- [Bun](https://bun.sh/)

然后执行：

```sh
bun install
./setup-runtime.sh
bun run build
```

构建产物位于 `src-tauri/target/release/bundle/`。

本地开发：

```sh
bun run dev
```

## 使用

OpenHarness 会在可用的本机回环端口上启动内置 Agent 服务，并在原生窗口中打开 Web UI。
在应用中配置模型服务商后，即可像使用上游 `dsh web` 命令一样使用该界面。

桌面端与上游命令行工具共用 `~/.dsh` 目录，因此已有的凭据、配置、会话和插件可以在
两种入口之间直接复用。Harness 本身的使用方式请参考上游
[用户指南](https://github.com/deepseek-ai/deepseek-harness/tree/master/docs/user/guide)。

## 工作原理

1. Tauri 使用内置 Node.js 和已发布的 `@deepseek-ai/dsh` 包启动
   `dsh web --port 0`。
2. 运行时自动选择可用的本地端口，并输出对应的回环地址。
3. OpenHarness 在原生 webview 中打开该地址。
4. 关闭窗口会隐藏到系统托盘；从托盘「退出」或 `Cmd+Q` 退出时，同时终止内置运行时进程。

桌面宿主不会复刻或重新实现上游 Web UI。运行时由
[`setup-runtime.sh`](setup-runtime.sh) 从已发布的 npm 包组装。

## 仓库结构

```text
.
|-- assets/                 OpenHarness 图标源文件
|-- frontend/dist/          Tauri 启动占位页
|-- runtime/                内置运行时清单与锁文件
|-- scripts/                运行时品牌补丁
|-- src-tauri/              Rust 宿主与 Tauri 配置
`-- setup-runtime.sh        内置运行时组装脚本
```

`src-tauri/runtime/` 由脚本在本地生成，不纳入 Git。

## 隐私

OpenHarness 的桌面宿主不增加遥测，并在启动内置运行时时明确关闭其遥测。提示词、附件和模型
请求仍会发送给用户主动配置的模型服务商；本地 Harness 数据继续保存在 `~/.dsh`。

## 参与贡献

欢迎为 OpenHarness 的桌面宿主提交 Issue 和 Pull Request。涉及底层 Agent 运行时或 Web UI
的改动，请提交到
[上游仓库](https://github.com/deepseek-ai/deepseek-harness)。

## 版权与许可证

Copyright 2026 MicroSpotlight.

OpenHarness 中原创的桌面宿主代码采用
[Apache License 2.0](LICENSE) 许可。

本应用内置的 [`@deepseek-ai/dsh`](https://www.npmjs.com/package/@deepseek-ai/dsh)
来自 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)，采用
[MIT License](https://github.com/deepseek-ai/deepseek-harness/blob/master/LICENSE)：

> Copyright (c) 2026 DeepSeek

上游 MIT 许可证全文会随 npm 包保留，并进入最终应用包。其他内置依赖仍分别遵循各自的
许可证。归属信息请参阅 [NOTICE](NOTICE)。
