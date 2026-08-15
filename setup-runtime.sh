#!/usr/bin/env bash
# 重建打包进 App 的自包含运行时：Node 二进制 + @deepseek-ai/dsh 依赖树。
# 产物位于 src-tauri/runtime/，已通过 .gitignore 排除出 git（node 二进制超过
# GitHub 100MB 单文件上限）。
set -euo pipefail
cd "$(dirname "$0")"

NODE_VERSION="v24.19.0"
# Keep these in sync with nodejs.org/dist/${NODE_VERSION}/SHASUMS256.txt.
case "$(uname -m)" in
  arm64)
    NODE_DIST_ARCH="arm64"
    NODE_BINARY_ARCH="arm64"
    NODE_SHA256="8294b7aa9b03997481c06babf1e8b270c859358f27da57a11509afe537ac381d"
    ;;
  x86_64)
    NODE_DIST_ARCH="x64"
    NODE_BINARY_ARCH="x86_64"
    NODE_SHA256="d1b5e999db158c62fe8f7267a4476b035d8bd93b1a605bac24a3f0dd166e3316"
    ;;
  *)
    echo "错误：不支持的 macOS 架构：$(uname -m)" >&2
    exit 1
    ;;
esac

NODE_DIST_DIR="node-${NODE_VERSION}-darwin-${NODE_DIST_ARCH}"
NODE_TARBALL="${NODE_DIST_DIR}.tar.gz"
NODE_URL="https://nodejs.org/dist/${NODE_VERSION}/${NODE_TARBALL}"

RUNTIME_DIR="src-tauri/runtime"
DSH_DIR="${RUNTIME_DIR}/dsh"
BIN_JS="${DSH_DIR}/node_modules/@deepseek-ai/dsh/lib/bin.js"
RUNTIME_MANIFEST_DIR="runtime"
RUNTIME_PACKAGE_JSON="${RUNTIME_MANIFEST_DIR}/package.json"
RUNTIME_LOCKFILE="${RUNTIME_MANIFEST_DIR}/bun.lock"
RUNTIME_STAMP="${DSH_DIR}/.openharness-runtime.sha256"

mkdir -p "${DSH_DIR}"

# 1) Node 二进制（与当前 Mac 架构匹配的官方自包含构建）
INSTALLED_NODE_ARCH="$(lipo -archs "${RUNTIME_DIR}/node" 2>/dev/null || true)"
INSTALLED_NODE_VERSION="$("${RUNTIME_DIR}/node" --version 2>/dev/null || true)"
if [[ ! -x "${RUNTIME_DIR}/node" || " ${INSTALLED_NODE_ARCH} " != *" ${NODE_BINARY_ARCH} "* || "${INSTALLED_NODE_VERSION}" != "${NODE_VERSION}" ]]; then
  if [[ -n "${INSTALLED_NODE_ARCH}" ]]; then
    echo ">> node 不匹配（当前 ${INSTALLED_NODE_VERSION}/${INSTALLED_NODE_ARCH}，需要 ${NODE_VERSION}/${NODE_BINARY_ARCH}），重新下载"
  fi
  echo ">> 下载 ${NODE_URL}"
  NODE_DOWNLOAD_DIR="$(mktemp -d "${TMPDIR:-/tmp}/openharness-node.XXXXXX")"
  trap 'rm -rf "${NODE_DOWNLOAD_DIR}"' EXIT
  curl -fsSL -o "${NODE_DOWNLOAD_DIR}/${NODE_TARBALL}" "${NODE_URL}"
  printf '%s  %s\n' "${NODE_SHA256}" "${NODE_DOWNLOAD_DIR}/${NODE_TARBALL}" | shasum -a 256 -c -
  tar -xzf "${NODE_DOWNLOAD_DIR}/${NODE_TARBALL}" -C "${NODE_DOWNLOAD_DIR}"
  cp "${NODE_DOWNLOAD_DIR}/${NODE_DIST_DIR}/bin/node" "${RUNTIME_DIR}/node"
  chmod +x "${RUNTIME_DIR}/node"
else
  echo ">> node 已存在，跳过"
fi

# 2) @deepseek-ai/dsh 依赖树
DSH_VERSION="$("${RUNTIME_DIR}/node" -p "require('./${RUNTIME_PACKAGE_JSON}').dependencies['@deepseek-ai/dsh']")"
RUNTIME_MANIFEST_HASH="$( { printf '%s\n' "${NODE_VERSION}"; shasum -a 256 "${RUNTIME_PACKAGE_JSON}" "${RUNTIME_LOCKFILE}"; } | shasum -a 256 | awk '{print $1}')"
INSTALLED_MANIFEST_HASH="$(cat "${RUNTIME_STAMP}" 2>/dev/null || true)"
INSTALLED_DSH_VERSION="$("${RUNTIME_DIR}/node" -p "try { require('./${DSH_DIR}/node_modules/@deepseek-ai/dsh/package.json').version } catch { '' }" 2>/dev/null || true)"

if [[ ! -f "${BIN_JS}" || "${INSTALLED_MANIFEST_HASH}" != "${RUNTIME_MANIFEST_HASH}" || "${INSTALLED_DSH_VERSION}" != "${DSH_VERSION}" ]]; then
  rm -rf "${DSH_DIR}"
  mkdir -p "${DSH_DIR}"
  cp "${RUNTIME_PACKAGE_JSON}" "${DSH_DIR}/package.json"
  cp "${RUNTIME_LOCKFILE}" "${DSH_DIR}/bun.lock"
  echo ">> bun install @deepseek-ai/dsh@${DSH_VERSION}"
  (cd "${DSH_DIR}" && bun install --production --frozen-lockfile --registry="https://registry.npmjs.org")
  printf '%s\n' "${RUNTIME_MANIFEST_HASH}" > "${RUNTIME_STAMP}"
else
  echo ">> dsh ${DSH_VERSION} 与锁文件一致，跳过"
fi

"${RUNTIME_DIR}/node" scripts/brand-runtime.mjs

echo ">> runtime 就绪: ${RUNTIME_DIR}"
