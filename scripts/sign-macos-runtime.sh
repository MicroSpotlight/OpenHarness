#!/usr/bin/env bash
set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "error: macOS runtime signing must run on macOS" >&2
  exit 1
fi

: "${APPLE_SIGNING_IDENTITY:?APPLE_SIGNING_IDENTITY is required}"

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RUNTIME_DIR="${REPO_ROOT}/src-tauri/runtime"
APP_ENTITLEMENTS="${REPO_ROOT}/src-tauri/OpenHarness.entitlements"

if [[ ! -x "${RUNTIME_DIR}/node" ]]; then
  echo "error: ${RUNTIME_DIR}/node is missing or not executable" >&2
  exit 1
fi

sign_macho() {
  local path="$1"
  local entitlements="${2:-}"
  local args=(--force --sign "${APPLE_SIGNING_IDENTITY}" --options runtime --timestamp)
  local attempt
  local backoff_seconds
  local max_attempts=6

  if [[ -n "${entitlements}" ]]; then
    args+=(--entitlements "${entitlements}")
  fi

  for ((attempt = 1; attempt <= max_attempts; attempt++)); do
    if codesign "${args[@]}" "${path}" \
      && codesign --verify --strict "${path}"; then
      return 0
    fi

    if ((attempt < max_attempts)); then
      backoff_seconds=$((15 * (2 ** (attempt - 1))))
      echo "warning: signing attempt ${attempt}/${max_attempts} failed; retrying in ${backoff_seconds} seconds" >&2
      sleep "${backoff_seconds}"
    fi
  done

  echo "error: failed to sign and verify a bundled Mach-O file after ${max_attempts} attempts: ${path}" >&2
  return 1
}

# The upstream Node binary carries broad development entitlements. Keep only
# V8's executable-memory permissions and library loading for user-installed
# native DSH plugins, then sign bundled Mach-O code with the same team.
sign_macho "${RUNTIME_DIR}/node" "${APP_ENTITLEMENTS}"

while IFS= read -r -d '' path; do
  if [[ "${path}" == "${RUNTIME_DIR}/node" ]]; then
    continue
  fi
  if file -b "${path}" | grep -q '^Mach-O'; then
    sign_macho "${path}"
  fi
done < <(find "${RUNTIME_DIR}" -type f -print0)

node_entitlements="$(codesign -d --entitlements - "${RUNTIME_DIR}/node" 2>&1)"
required_entitlements=(
  com.apple.security.cs.allow-jit
  com.apple.security.cs.allow-unsigned-executable-memory
  com.apple.security.cs.disable-library-validation
)
for entitlement in "${required_entitlements[@]}"; do
  if ! grep -Fq "${entitlement}" <<< "${node_entitlements}"; then
    echo "error: signed Node runtime is missing required entitlement: ${entitlement}" >&2
    exit 1
  fi
done

forbidden_entitlements=(
  com.apple.security.get-task-allow
  com.apple.security.cs.allow-dyld-environment-variables
  com.apple.security.cs.disable-executable-page-protection
)
for entitlement in "${forbidden_entitlements[@]}"; do
  if grep -Fq "${entitlement}" <<< "${node_entitlements}"; then
    echo "error: signed Node runtime contains forbidden entitlement: ${entitlement}" >&2
    exit 1
  fi
done

echo "Signed all bundled macOS runtime code."
