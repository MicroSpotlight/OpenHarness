#!/usr/bin/env bash
set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "error: DMG creation must run on macOS" >&2
  exit 1
fi

if [[ "$#" -ne 3 ]]; then
  echo "usage: $0 <app-path> <output-dmg> <volume-name>" >&2
  exit 64
fi

APP_PATH="$1"
OUTPUT_DMG="$2"
VOLUME_NAME="$3"

if [[ ! -d "${APP_PATH}" || "${APP_PATH}" != *.app ]]; then
  echo "error: signed application bundle not found: ${APP_PATH}" >&2
  exit 1
fi
if [[ "${OUTPUT_DMG}" != *.dmg ]]; then
  echo "error: output path must end in .dmg" >&2
  exit 1
fi

OUTPUT_DIR="$(dirname "${OUTPUT_DMG}")"
mkdir -p "${OUTPUT_DIR}"
OUTPUT_DIR="$(cd "${OUTPUT_DIR}" && pwd)"
OUTPUT_DMG="${OUTPUT_DIR}/$(basename "${OUTPUT_DMG}")"

STAGING_ROOT="$(mktemp -d "${RUNNER_TEMP:-${TMPDIR:-/tmp}}/openharness-dmg.XXXXXX")"
STAGING_DIR="${STAGING_ROOT}/${VOLUME_NAME}"
mkdir -p "${STAGING_DIR}"

cleanup() {
  rm -rf "${STAGING_ROOT}"
}
trap cleanup EXIT

echo "Preparing DMG staging directory..."
ditto "${APP_PATH}" "${STAGING_DIR}/$(basename "${APP_PATH}")"
ln -s /Applications "${STAGING_DIR}/Applications"

APP_ICON="$(dirname "${BASH_SOURCE[0]}")/../src-tauri/icons/icon.icns"
if [[ -f "${APP_ICON}" ]] && command -v SetFile >/dev/null 2>&1; then
  cp "${APP_ICON}" "${STAGING_DIR}/.VolumeIcon.icns"
  SetFile -c icnC "${STAGING_DIR}/.VolumeIcon.icns"
  SetFile -a V "${STAGING_DIR}/.VolumeIcon.icns"
  SetFile -a C "${STAGING_DIR}"
fi

max_attempts=3
for ((attempt = 1; attempt <= max_attempts; attempt++)); do
  echo "Creating compressed DMG (attempt ${attempt}/${max_attempts})..."
  rm -f "${OUTPUT_DMG}"
  sync

  if hdiutil create \
    -ov \
    -srcfolder "${STAGING_DIR}" \
    -volname "${VOLUME_NAME}" \
    -fs HFS+ \
    -format UDZO \
    -imagekey zlib-level=9 \
    "${OUTPUT_DMG}"; then
    if hdiutil verify "${OUTPUT_DMG}"; then
      echo "DMG creation and checksum verification succeeded."
      exit 0
    else
      echo "DMG checksum verification failed on attempt ${attempt}/${max_attempts}." >&2
    fi
  fi

  if ((attempt < max_attempts)); then
    backoff_seconds=$((attempt * 15))
    echo "DMG creation failed; retrying in ${backoff_seconds} seconds..." >&2
    sleep "${backoff_seconds}"
  fi
done

echo "error: failed to create a valid DMG after ${max_attempts} attempts" >&2
exit 1
