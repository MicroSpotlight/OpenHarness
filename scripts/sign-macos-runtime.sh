#!/usr/bin/env bash
set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "error: macOS runtime signing must run on macOS" >&2
  exit 1
fi

: "${APPLE_SIGNING_IDENTITY:?APPLE_SIGNING_IDENTITY is required}"

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RUNTIME_DIR="${REPO_ROOT}/src-tauri/runtime"
NODE_ENTITLEMENTS="${REPO_ROOT}/src-tauri/NodeRuntime.entitlements"

if [[ ! -x "${RUNTIME_DIR}/node" ]]; then
  echo "error: ${RUNTIME_DIR}/node is missing or not executable" >&2
  exit 1
fi

sign_macho() {
  local path="$1"
  local entitlements="${2:-}"
  local args=(--force --sign "${APPLE_SIGNING_IDENTITY}" --options runtime --timestamp)

  if [[ -n "${entitlements}" ]]; then
    args+=(--entitlements "${entitlements}")
  fi

  codesign "${args[@]}" "${path}"
  codesign --verify --strict --verbose=2 "${path}"
}

# The upstream Node binary carries get-task-allow, which Apple rejects for
# notarized distribution. Re-sign it with only the runtime permissions Node/V8
# needs, then sign every bundled Mach-O addon and library with the same team.
sign_macho "${RUNTIME_DIR}/node" "${NODE_ENTITLEMENTS}"

while IFS= read -r -d '' path; do
  if [[ "${path}" == "${RUNTIME_DIR}/node" ]]; then
    continue
  fi
  if file -b "${path}" | grep -q '^Mach-O'; then
    sign_macho "${path}"
  fi
done < <(find "${RUNTIME_DIR}" -type f -print0)

if codesign -d --entitlements - "${RUNTIME_DIR}/node" 2>&1 \
  | grep -q 'com.apple.security.get-task-allow'; then
  echo "error: signed Node runtime still contains get-task-allow" >&2
  exit 1
fi

echo "Signed all bundled macOS runtime code."
