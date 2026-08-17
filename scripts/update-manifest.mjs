import { readFile, stat, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const APP_NAME = "OpenHarness";
const PLATFORM_KEYS = [
  "darwin-aarch64",
  "darwin-x86_64",
  "windows-aarch64",
  "windows-x86_64",
  "linux-aarch64",
  "linux-x86_64",
];
const ASSET_VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;
const BUILD_NUMBER_PATTERN = /^(0|[1-9]\d*)(?:\.(0|[1-9]\d*)){0,2}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/;
const RFC3339_UTC_PATTERN = /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\dZ$/;

function requireString(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value.trim();
}

function requireHttpsUrl(value, label) {
  const url = new URL(requireString(value, label));
  if (url.protocol !== "https:") throw new Error(`${label} must use HTTPS`);
  return url.toString();
}

function requireObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value;
}

function requirePositiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }
  return value;
}

function requireBuildNumber(value, label) {
  const buildNumber = requireString(value, label);
  if (!BUILD_NUMBER_PATTERN.test(buildNumber) || buildNumber.split(".").every((part) => part === "0")) {
    throw new Error(`${label} must be a positive numeric build number`);
  }
  return buildNumber;
}

function requireSignature(value, label) {
  const signature = requireString(value, label);
  if (!BASE64_PATTERN.test(signature) || signature.length % 4 !== 0) {
    throw new Error(`${label} must be a base64-encoded Tauri signature`);
  }
  return signature;
}

function requireRfc3339Utc(value, label) {
  const timestamp = requireString(value, label);
  const parsed = new Date(timestamp);
  const canonical = Number.isNaN(parsed.valueOf())
    ? ""
    : parsed.toISOString().replace(".000Z", "Z");
  if (!RFC3339_UTC_PATTERN.test(timestamp) || canonical !== timestamp) {
    throw new Error(`${label} must use UTC RFC 3339 format (YYYY-MM-DDTHH:mm:ssZ)`);
  }
  return timestamp;
}

export function parseReleaseVersion(value) {
  const version = requireString(value, "version");
  const match = VERSION_PATTERN.exec(version);
  if (!match) throw new Error(`Invalid release version: ${version}`);
  return {
    version,
    major: match[1],
    minor: match[2],
    patch: match[3],
    prerelease: Boolean(match[4]),
  };
}

function releaseAssetUrl(repository, tag, filename) {
  return `https://github.com/${repository}/releases/download/${encodeURIComponent(tag)}/${encodeURIComponent(filename)}`;
}

export function assetNames(version) {
  if (!ASSET_VERSION_PATTERN.test(version)) {
    throw new Error(`Invalid asset version: ${version}`);
  }
  return {
    aarch64: {
      updater: `${APP_NAME}_${version}_aarch64.app.tar.gz`,
      dmg: `${APP_NAME}_${version}_arm64.dmg`,
    },
    x86_64: {
      updater: `${APP_NAME}_${version}_x86_64.app.tar.gz`,
      dmg: `${APP_NAME}_${version}_x64.dmg`,
    },
    windows_x86_64: {
      updater: `${APP_NAME}_${version}_x64-setup.exe`,
      installer: `${APP_NAME}_${version}_x64-setup.exe`,
    },
    windows_aarch64: {
      updater: `${APP_NAME}_${version}_arm64-setup.exe`,
      installer: `${APP_NAME}_${version}_arm64-setup.exe`,
    },
    linux_x86_64: {
      updater: `${APP_NAME}_${version}_amd64.AppImage`,
      installer: `${APP_NAME}_${version}_amd64.AppImage`,
      deb: `${APP_NAME}_${version}_amd64.deb`,
    },
    linux_aarch64: {
      updater: `${APP_NAME}_${version}_arm64.AppImage`,
      installer: `${APP_NAME}_${version}_arm64.AppImage`,
      deb: `${APP_NAME}_${version}_arm64.deb`,
    },
  };
}

export function validateUpdateManifest(manifest) {
  requireObject(manifest, "manifest");
  try {
    parseReleaseVersion(manifest.version ?? "");
  } catch {
    throw new Error("manifest.version must be a valid SemVer version");
  }
  requireBuildNumber(manifest.build_number, "manifest.build_number");
  if (typeof manifest.notes !== "string") throw new Error("manifest.notes must be a string");
  requireRfc3339Utc(manifest.pub_date, "manifest.pub_date");

  const platforms = requireObject(manifest.platforms, "manifest.platforms");
  const downloads = requireObject(manifest.downloads, "manifest.downloads");
  const platformKeys = Object.keys(platforms);
  if (platformKeys.length === 0) throw new Error("manifest.platforms must not be empty");
  for (const platformKey of platformKeys) {
    if (!PLATFORM_KEYS.includes(platformKey)) {
      throw new Error(`manifest.platforms contains unsupported platform ${platformKey}`);
    }
    const platform = requireObject(platforms[platformKey], `manifest.platforms.${platformKey}`);
    requireHttpsUrl(platform.url, `manifest.platforms.${platformKey}.url`);
    requireSignature(platform.signature, `manifest.platforms.${platformKey}.signature`);

    const download = requireObject(downloads[platformKey], `manifest.downloads.${platformKey}`);
    requireHttpsUrl(download.url, `manifest.downloads.${platformKey}.url`);
    requireString(download.name, `manifest.downloads.${platformKey}.name`);
    requirePositiveInteger(download.size, `manifest.downloads.${platformKey}.size`);
    if (!SHA256_PATTERN.test(download.sha256 ?? "")) {
      throw new Error(`manifest.downloads.${platformKey}.sha256 must be a lowercase SHA-256 digest`);
    }
  }
  for (const platformKey of Object.keys(downloads)) {
    if (!platforms[platformKey]) {
      throw new Error(`manifest.downloads.${platformKey} does not have an updater platform entry`);
    }
  }
  return manifest;
}

export function createUpdateManifest({
  version,
  assetVersion,
  buildNumber,
  tag,
  repository,
  pubDate,
  notes,
  signatures,
  checksums,
  sizes,
}) {
  parseReleaseVersion(version);
  const releaseTag = requireString(tag, "tag");
  const repo = requireString(repository, "repository");
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) {
    throw new Error("repository must use owner/name format");
  }
  const names = assetNames(assetVersion);
  const artifacts = {
    "darwin-aarch64": {
      updater: names.aarch64.updater,
      installer: names.aarch64.dmg,
      values: "aarch64",
    },
    "darwin-x86_64": {
      updater: names.x86_64.updater,
      installer: names.x86_64.dmg,
      values: "x86_64",
    },
    "windows-x86_64": {
      updater: names.windows_x86_64.updater,
      installer: names.windows_x86_64.installer,
      values: "windows_x86_64",
    },
    "windows-aarch64": {
      updater: names.windows_aarch64.updater,
      installer: names.windows_aarch64.installer,
      values: "windows_aarch64",
    },
    "linux-x86_64": {
      updater: names.linux_x86_64.updater,
      installer: names.linux_x86_64.installer,
      values: "linux_x86_64",
    },
    "linux-aarch64": {
      updater: names.linux_aarch64.updater,
      installer: names.linux_aarch64.installer,
      values: "linux_aarch64",
    },
  };

  return validateUpdateManifest({
    version,
    build_number: requireBuildNumber(buildNumber, "buildNumber"),
    notes: typeof notes === "string" ? notes.trim() : "",
    pub_date: requireString(pubDate, "pubDate"),
    platforms: Object.fromEntries(
      Object.entries(artifacts).map(([platform, artifact]) => [
        platform,
        {
          signature: requireSignature(signatures[artifact.values], `${platform} signature`),
          url: releaseAssetUrl(repo, releaseTag, artifact.updater),
        },
      ]),
    ),
    downloads: Object.fromEntries(
      Object.entries(artifacts).map(([platform, artifact]) => [
        platform,
        {
          url: releaseAssetUrl(repo, releaseTag, artifact.installer),
          name: artifact.installer,
          sha256: requireString(checksums[artifact.values], `${platform} checksum`).toLowerCase(),
          size: requirePositiveInteger(sizes[artifact.values], `${platform} installer size`),
        },
      ]),
    ),
  });
}

function parseArguments(argv) {
  const [command, ...rest] = argv;
  const options = {};
  for (let index = 0; index < rest.length; index += 2) {
    const flag = rest[index];
    const value = rest[index + 1];
    if (!flag?.startsWith("--") || value === undefined) {
      throw new Error(`Invalid argument near ${flag ?? "end of command"}`);
    }
    options[flag.slice(2)] = value;
  }
  return { command, options };
}

async function readTrimmed(path, label) {
  return requireString(await readFile(path, "utf8"), label);
}

async function readArtifactSize(path, label) {
  const artifact = await stat(path);
  if (!artifact.isFile()) throw new Error(`${label} must be a file`);
  return requirePositiveInteger(artifact.size, `${label} size`);
}

async function generate(options) {
  const manifest = createUpdateManifest({
    version: options.version,
    assetVersion: options["asset-version"],
    buildNumber: options["build-number"],
    tag: options.tag,
    repository: options.repository,
    pubDate: options["pub-date"],
    notes: await readFile(options["notes-file"], "utf8"),
    signatures: {
      aarch64: await readTrimmed(options["aarch64-signature"], "aarch64 signature"),
      x86_64: await readTrimmed(options["x86-signature"], "x86_64 signature"),
      windows_x86_64: await readTrimmed(options["windows-x64-signature"], "Windows x64 signature"),
      windows_aarch64: await readTrimmed(options["windows-arm64-signature"], "Windows arm64 signature"),
      linux_x86_64: await readTrimmed(options["linux-x64-signature"], "Linux x64 signature"),
      linux_aarch64: await readTrimmed(options["linux-arm64-signature"], "Linux arm64 signature"),
    },
    checksums: {
      aarch64: (await readTrimmed(options["aarch64-sha256"], "aarch64 checksum")).split(/\s+/)[0],
      x86_64: (await readTrimmed(options["x86-sha256"], "x86_64 checksum")).split(/\s+/)[0],
      windows_x86_64: (await readTrimmed(options["windows-x64-sha256"], "Windows x64 checksum")).split(/\s+/)[0],
      windows_aarch64: (await readTrimmed(options["windows-arm64-sha256"], "Windows arm64 checksum")).split(/\s+/)[0],
      linux_x86_64: (await readTrimmed(options["linux-x64-sha256"], "Linux x64 checksum")).split(/\s+/)[0],
      linux_aarch64: (await readTrimmed(options["linux-arm64-sha256"], "Linux arm64 checksum")).split(/\s+/)[0],
    },
    sizes: {
      aarch64: await readArtifactSize(options["aarch64-dmg"], "aarch64 DMG"),
      x86_64: await readArtifactSize(options["x86-dmg"], "x86_64 DMG"),
      windows_x86_64: await readArtifactSize(options["windows-x64-installer"], "Windows x64 installer"),
      windows_aarch64: await readArtifactSize(options["windows-arm64-installer"], "Windows arm64 installer"),
      linux_x86_64: await readArtifactSize(options["linux-x64-appimage"], "Linux x64 AppImage"),
      linux_aarch64: await readArtifactSize(options["linux-arm64-appimage"], "Linux arm64 AppImage"),
    },
  });
  await writeFile(options.output, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

async function validate(path) {
  validateUpdateManifest(JSON.parse(await readFile(path, "utf8")));
}

async function main(argv) {
  const { command, options } = parseArguments(argv);
  if (command === "generate") {
    await generate(options);
  } else if (command === "validate") {
    if (!options.input) throw new Error("Usage: update-manifest.mjs validate --input <path>");
    await validate(options.input);
  } else if (command === "validate-version") {
    if (!options.version) {
      throw new Error("Usage: update-manifest.mjs validate-version --version <version>");
    }
    parseReleaseVersion(options.version);
  } else {
    throw new Error("Usage: update-manifest.mjs <generate|validate|validate-version> [options]");
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
