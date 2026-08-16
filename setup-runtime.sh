#!/usr/bin/env bash
# 重建打包进 App 的自包含运行时：Node 二进制 + @deepseek-ai/dsh 依赖树。
# 产物位于 src-tauri/runtime/，已通过 .gitignore 排除出 git（node 二进制超过
# GitHub 100MB 单文件上限）。
set -euo pipefail
cd "$(dirname "$0")"

NODE_VERSION="v24.19.0"
# Keep these in sync with nodejs.org/dist/${NODE_VERSION}/SHASUMS256.txt.
HOST_MACHINE="$(uname -m)"
case "${HOST_MACHINE}" in
  arm64 | x86_64) ;;
  *)
    echo "错误：不支持的 macOS 主机架构：${HOST_MACHINE}" >&2
    exit 1
    ;;
esac

RUNTIME_CPU="${OPENHARNESS_RUNTIME_CPU:-}"
if [[ -z "${RUNTIME_CPU}" ]]; then
  case "${HOST_MACHINE}" in
    arm64) RUNTIME_CPU="arm64" ;;
    x86_64) RUNTIME_CPU="x64" ;;
  esac
fi

case "${RUNTIME_CPU}" in
  arm64)
    NODE_DIST_ARCH="arm64"
    NODE_BINARY_ARCH="arm64"
    NODE_SHA256="8294b7aa9b03997481c06babf1e8b270c859358f27da57a11509afe537ac381d"
    ;;
  x64)
    NODE_DIST_ARCH="x64"
    NODE_BINARY_ARCH="x86_64"
    NODE_SHA256="d1b5e999db158c62fe8f7267a4476b035d8bd93b1a605bac24a3f0dd166e3316"
    ;;
  *)
    echo "错误：OPENHARNESS_RUNTIME_CPU 必须是 arm64 或 x64，当前为 ${RUNTIME_CPU}" >&2
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
RUNTIME_NATIVE_BRIDGE="${RUNTIME_MANIFEST_DIR}/native-bridge"
RUNTIME_PATCH="${RUNTIME_MANIFEST_DIR}/openharness.patch.yml"
RUNTIME_STAMP="${DSH_DIR}/.openharness-runtime.sha256"
NODE_STAMP="${RUNTIME_DIR}/.openharness-node-version"

mkdir -p "${DSH_DIR}"

# 1) Node 二进制（与目标架构匹配的官方自包含构建）
INSTALLED_NODE_ARCH="$(lipo -archs "${RUNTIME_DIR}/node" 2>/dev/null || true)"
EXPECTED_NODE_STAMP="${NODE_VERSION}/${NODE_BINARY_ARCH}"
INSTALLED_NODE_STAMP="$(cat "${NODE_STAMP}" 2>/dev/null || true)"
if [[ ! -x "${RUNTIME_DIR}/node" || " ${INSTALLED_NODE_ARCH} " != *" ${NODE_BINARY_ARCH} "* || "${INSTALLED_NODE_STAMP}" != "${EXPECTED_NODE_STAMP}" ]]; then
  if [[ -n "${INSTALLED_NODE_ARCH}" ]]; then
    echo ">> node 不匹配（当前 ${INSTALLED_NODE_STAMP:-unknown}/${INSTALLED_NODE_ARCH}，需要 ${EXPECTED_NODE_STAMP}），重新下载"
  fi
  echo ">> 下载 ${NODE_URL}"
  NODE_DOWNLOAD_DIR="$(mktemp -d "${TMPDIR:-/tmp}/openharness-node.XXXXXX")"
  trap '[[ -n "${NODE_DOWNLOAD_DIR:-}" ]] && rm -rf -- "${NODE_DOWNLOAD_DIR}"' EXIT
  curl -fsSL -o "${NODE_DOWNLOAD_DIR}/${NODE_TARBALL}" "${NODE_URL}"
  printf '%s  %s\n' "${NODE_SHA256}" "${NODE_DOWNLOAD_DIR}/${NODE_TARBALL}" | shasum -a 256 -c -
  tar -xzf "${NODE_DOWNLOAD_DIR}/${NODE_TARBALL}" -C "${NODE_DOWNLOAD_DIR}"
  cp "${NODE_DOWNLOAD_DIR}/${NODE_DIST_DIR}/bin/node" "${RUNTIME_DIR}/node"
  chmod +x "${RUNTIME_DIR}/node"
  printf '%s\n' "${EXPECTED_NODE_STAMP}" > "${NODE_STAMP}"
else
  echo ">> node 已存在，跳过"
fi

INSTALLED_NODE_ARCH="$(lipo -archs "${RUNTIME_DIR}/node")"
if [[ " ${INSTALLED_NODE_ARCH} " != *" ${NODE_BINARY_ARCH} "* ]]; then
  echo "错误：Node 架构 ${INSTALLED_NODE_ARCH} 不包含目标架构 ${NODE_BINARY_ARCH}" >&2
  exit 1
fi

# 2) @deepseek-ai/dsh 依赖树
DSH_VERSION="$(jq -er '.dependencies["@deepseek-ai/dsh"] | strings | select(length > 0)' "${RUNTIME_PACKAGE_JSON}")"
BUN_VERSION="$(bun --version)"
RUNTIME_MANIFEST_HASH="$( { printf '%s\n' "${NODE_VERSION}" "${RUNTIME_CPU}" "${BUN_VERSION}"; find "${RUNTIME_NATIVE_BRIDGE}" -type f -print0 | sort -z | xargs -0 shasum -a 256; shasum -a 256 "${RUNTIME_PACKAGE_JSON}" "${RUNTIME_LOCKFILE}" "${RUNTIME_PATCH}"; } | shasum -a 256 | awk '{print $1}')"
INSTALLED_MANIFEST_HASH="$(cat "${RUNTIME_STAMP}" 2>/dev/null || true)"
INSTALLED_DSH_PACKAGE="${DSH_DIR}/node_modules/@deepseek-ai/dsh/package.json"
INSTALLED_DSH_VERSION="$(jq -r '.version // empty' "${INSTALLED_DSH_PACKAGE}" 2>/dev/null || true)"

if [[ ! -f "${BIN_JS}" || "${INSTALLED_MANIFEST_HASH}" != "${RUNTIME_MANIFEST_HASH}" || "${INSTALLED_DSH_VERSION}" != "${DSH_VERSION}" ]]; then
  rm -rf "${DSH_DIR}"
  mkdir -p "${DSH_DIR}"
  cp "${RUNTIME_PACKAGE_JSON}" "${DSH_DIR}/package.json"
  cp "${RUNTIME_LOCKFILE}" "${DSH_DIR}/bun.lock"
  cp -R "${RUNTIME_NATIVE_BRIDGE}" "${DSH_DIR}/native-bridge"
  cp "${RUNTIME_PATCH}" "${DSH_DIR}/openharness.patch.yml"
  echo ">> bun install @deepseek-ai/dsh@${DSH_VERSION} for darwin-${RUNTIME_CPU}"
  (
    cd "${DSH_DIR}"
    bun install \
      --production \
      --frozen-lockfile \
      --cpu="${RUNTIME_CPU}" \
      --os=darwin \
      --registry="https://registry.npmjs.org"
  )
  printf '%s\n' "${RUNTIME_MANIFEST_HASH}" > "${RUNTIME_STAMP}"
else
  echo ">> dsh ${DSH_VERSION} 与锁文件一致，跳过"
fi

bun scripts/brand-runtime.mjs

verify_macho_tree() {
  local label="$1"
  local search_root="$2"
  local macho_count=0
  local candidate
  local candidate_archs

  if [[ ! -e "${search_root}" ]]; then
    echo "错误：缺少 ${label}: ${search_root}" >&2
    return 1
  fi

  while IFS= read -r -d '' candidate; do
    if ! file -b "${candidate}" | grep -q '^Mach-O'; then
      continue
    fi
    macho_count=$((macho_count + 1))
    candidate_archs="$(lipo -archs "${candidate}")"
    if [[ " ${candidate_archs} " != *" ${NODE_BINARY_ARCH} "* ]]; then
      echo "错误：${label} 中的 ${candidate} 架构为 ${candidate_archs}，需要 ${NODE_BINARY_ARCH}" >&2
      return 1
    fi
  done < <(find "${search_root}" -type f -print0)

  if [[ "${macho_count}" -eq 0 ]]; then
    echo "错误：${label} 中未找到 Mach-O 文件: ${search_root}" >&2
    return 1
  fi
}

echo ">> 静态校验 darwin-${RUNTIME_CPU} 原生运行时"
verify_macho_tree "node-pty" "${DSH_DIR}/node_modules/node-pty/prebuilds/darwin-${RUNTIME_CPU}"
verify_macho_tree "sharp" "${DSH_DIR}/node_modules/@img/sharp-darwin-${RUNTIME_CPU}"
verify_macho_tree "libvips" "${DSH_DIR}/node_modules/@img/sharp-libvips-darwin-${RUNTIME_CPU}"
verify_macho_tree "koffi" "${DSH_DIR}/node_modules/@koromix/koffi-darwin-${RUNTIME_CPU}"
verify_macho_tree "ripgrep" "${DSH_DIR}/node_modules/@vscode/ripgrep-darwin-${RUNTIME_CPU}"

if [[ ( "${HOST_MACHINE}" == "arm64" && "${RUNTIME_CPU}" == "arm64" ) || ( "${HOST_MACHINE}" == "x86_64" && "${RUNTIME_CPU}" == "x64" ) ]]; then
  echo ">> 执行校验原生运行时"
  if [[ "$("${RUNTIME_DIR}/node" --version)" != "${NODE_VERSION}" ]]; then
    echo "错误：Node 版本与目标版本 ${NODE_VERSION} 不一致" >&2
    exit 1
  fi
  (
    cd "${DSH_DIR}"
    ../node -e "require('node-pty'); require('sharp'); require('koffi')"
  )
else
  echo ">> 跳过在 ${HOST_MACHINE} 主机执行 ${RUNTIME_CPU} Node；已完成目标原生模块静态校验"
fi

echo ">> runtime 就绪: ${RUNTIME_DIR}"
