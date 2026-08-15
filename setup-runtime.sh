#!/usr/bin/env bash
# 重建打包进 App 的自包含运行时：Node 二进制 + @deepseek-ai/dsh 依赖树。
# 产物位于 src-tauri/runtime/，已通过 .gitignore 排除出 git（node 二进制超过
# GitHub 100MB 单文件上限）。
set -euo pipefail
cd "$(dirname "$0")"

NODE_VERSION="v24.19.0"
case "$(uname -m)" in
  arm64)
    NODE_DIST_ARCH="arm64"
    NODE_BINARY_ARCH="arm64"
    ;;
  x86_64)
    NODE_DIST_ARCH="x64"
    NODE_BINARY_ARCH="x86_64"
    ;;
  *)
    echo "错误：不支持的 macOS 架构：$(uname -m)" >&2
    exit 1
    ;;
esac

NODE_DIST_DIR="node-${NODE_VERSION}-darwin-${NODE_DIST_ARCH}"
NODE_TARBALL="${NODE_DIST_DIR}.tar.gz"
NODE_URL="https://nodejs.org/dist/${NODE_VERSION}/${NODE_TARBALL}"
NODE_SHASUMS_URL="https://nodejs.org/dist/${NODE_VERSION}/SHASUMS256.txt"
DSH_VERSION="0.1.0-rc.6"

RUNTIME_DIR="src-tauri/runtime"
DSH_DIR="${RUNTIME_DIR}/dsh"
BIN_JS="${DSH_DIR}/node_modules/@deepseek-ai/dsh/lib/bin.js"

mkdir -p "${DSH_DIR}"

# 1) Node 二进制（与当前 Mac 架构匹配的官方自包含构建）
INSTALLED_NODE_ARCH="$(lipo -archs "${RUNTIME_DIR}/node" 2>/dev/null || true)"
if [[ ! -x "${RUNTIME_DIR}/node" || " ${INSTALLED_NODE_ARCH} " != *" ${NODE_BINARY_ARCH} "* ]]; then
  if [[ -n "${INSTALLED_NODE_ARCH}" ]]; then
    echo ">> node 架构不匹配（当前 ${INSTALLED_NODE_ARCH}，需要 ${NODE_BINARY_ARCH}），重新下载"
  fi
  echo ">> 下载 ${NODE_URL}"
  curl -fsSL -o "/tmp/${NODE_TARBALL}" "${NODE_URL}"
  curl -fsSL -o "/tmp/${NODE_TARBALL}.shasums" "${NODE_SHASUMS_URL}"
  EXPECTED_NODE_SHA256="$(awk -v filename="${NODE_TARBALL}" '$2 == filename { print $1 }' "/tmp/${NODE_TARBALL}.shasums")"
  if [[ -z "${EXPECTED_NODE_SHA256}" ]]; then
    echo "错误：在 Node.js SHASUMS256.txt 中找不到 ${NODE_TARBALL}" >&2
    exit 1
  fi
  ACTUAL_NODE_SHA256="$(shasum -a 256 "/tmp/${NODE_TARBALL}" | awk '{ print $1 }')"
  if [[ "${ACTUAL_NODE_SHA256}" != "${EXPECTED_NODE_SHA256}" ]]; then
    echo "错误：${NODE_TARBALL} SHA-256 校验失败" >&2
    exit 1
  fi
  tar -xzf "/tmp/${NODE_TARBALL}" -C /tmp
  cp "/tmp/${NODE_DIST_DIR}/bin/node" "${RUNTIME_DIR}/node"
  chmod +x "${RUNTIME_DIR}/node"
  rm -rf "/tmp/${NODE_TARBALL}" "/tmp/${NODE_TARBALL}.shasums" "/tmp/${NODE_DIST_DIR}"
else
  echo ">> node 已存在，跳过"
fi

# 2) @deepseek-ai/dsh 依赖树
if [[ ! -f "${BIN_JS}" ]]; then
  cat > "${DSH_DIR}/package.json" <<EOF
{
  "name": "dsh-runtime",
  "private": true,
  "trustedDependencies": [
    "@deepseek-ai/dsh-subprocess-local",
    "node-pty"
  ],
  "dependencies": {
    "@deepseek-ai/dsh": "${DSH_VERSION}"
  }
}
EOF
  echo ">> bun install @deepseek-ai/dsh@${DSH_VERSION}"
  (cd "${DSH_DIR}" && bun install --production --registry="https://registry.npmjs.org")
else
  echo ">> dsh 已存在，跳过"
fi

echo ">> 校验原生运行时"
(
  cd "${DSH_DIR}"
  ../node -e "require('node-pty'); require('sharp'); require('koffi')"
)

echo ">> runtime 就绪: ${RUNTIME_DIR}"
