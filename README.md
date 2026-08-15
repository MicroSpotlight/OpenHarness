# DeepSeek Harness 桌面端 (deepseek-desktop)

把 `bunx @deepseek-ai/dsh web` 改造成 macOS 原生桌面应用：一个 Tauri 壳，负责启动内置的
DSH Web 后端（Node + `@deepseek-ai/dsh` 运行时已打包进 App），再用原生窗口承载浏览器界面。

## 目录结构

- `src-tauri/` — Tauri 工程（Rust 主程序、配置、图标）
  - `src/main.rs` — 启动逻辑：spawn `dsh web --port 0` → 解析 URL → 建原生窗口 → 退出清理
  - `runtime/` — 打包进 App 的运行时（**gitignored**，由 `setup-runtime.sh` 生成）：`node`（Node.js 24 LTS 官方二进制）+ `dsh/node_modules`（完整 DSH 依赖树）
- `frontend/dist/` — 占位页（窗口实际加载的是 DSH 后端动态分配的 `http://127.0.0.1:<port>`）
- `assets/` — 图标源文件
- `setup-runtime.sh` — 下载 Node 二进制 + 安装 `@deepseek-ai/dsh`，重建 `src-tauri/runtime/`

## 构建

前置：macOS + Xcode 命令行工具 + Rust（rustup）+ Bun。

```bash
bun install                 # 安装 @tauri-apps/cli
./setup-runtime.sh          # 重建 src-tauri/runtime/（Node 二进制 + dsh 依赖树）
bun run build               # 等价于 tauri build，产出 .app 与 .dmg
# 仅构建 .app：
bun run tauri build --bundles app
# 仅构建 .dmg：
bun run tauri build --bundles dmg
```

产物位置：

- `.app`：`src-tauri/target/release/bundle/macos/DeepSeek Harness.app`
- `.dmg`：`src-tauri/target/release/bundle/dmg/DeepSeek Harness_0.1.0_<arch>.dmg`

## 使用

1. 打开 `.dmg`，把 `DeepSeek Harness.app` 拖进 `Applications`。
2. 双击启动。App 会在本地随机端口启动 DSH Web 后端，并在原生窗口打开界面。
3. 数据与配置复用你现有的 `~/.dsh`（与命令行 `dsh` 一致，包括模型凭据、会话、插件等）。

> 由于当前为未签名/未公证的本地构建，首次打开若被 Gatekeeper 拦截，右键 App →
> 「打开」即可。正式分发请配置 Apple Developer 签名 + 公证。

## 说明

- 端口：后端用 `--port 0` 让系统自动分配空闲端口，App 从后端打印的
  `dsh web: http://127.0.0.1:<port>` 行解析出地址后加载，避免端口冲突。
- 退出：关闭窗口或 `Cmd+Q` 会随之关闭内置 DSH 后端进程。
