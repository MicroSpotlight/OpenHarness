import assert from "node:assert/strict";
import test from "node:test";

import {
  assetNames,
  createUpdateManifest,
  parseReleaseVersion,
  validateUpdateManifest,
} from "./update-manifest.mjs";

const signature = Buffer.from("untrusted comment: test signature\nAAAA\n").toString("base64");
const checksum = "a".repeat(64);

test("creates Tauri platform entries and website download metadata", () => {
  const manifest = createUpdateManifest({
    version: "0.1.0-beta.1",
    assetVersion: "0.1.0",
    buildNumber: "42",
    tag: "v0.1.0-beta.1",
    repository: "MicroSpotlight/OpenHarness",
    pubDate: "2026-08-15T12:00:00Z",
    notes: "Signed update",
    signatures: { aarch64: signature, x86_64: signature },
    checksums: { aarch64: checksum, x86_64: checksum },
    sizes: { aarch64: 120_000_000, x86_64: 125_000_000 },
  });

  assert.equal(manifest.version, "0.1.0-beta.1");
  assert.equal(manifest.build_number, "42");
  assert.equal(
    manifest.platforms["darwin-aarch64"].url,
    "https://github.com/MicroSpotlight/OpenHarness/releases/download/v0.1.0-beta.1/OpenHarness_0.1.0_aarch64.app.tar.gz",
  );
  assert.equal(
    manifest.downloads["darwin-x86_64"].url,
    "https://github.com/MicroSpotlight/OpenHarness/releases/download/v0.1.0-beta.1/OpenHarness_0.1.0_x64.dmg",
  );
  assert.equal(manifest.downloads["darwin-aarch64"].name, "OpenHarness_0.1.0_arm64.dmg");
  assert.equal(manifest.downloads["darwin-x86_64"].size, 125_000_000);
});

test("keeps user-facing DMG names separate from updater archives", () => {
  assert.deepEqual(assetNames("1.2.3"), {
    aarch64: {
      updater: "OpenHarness_1.2.3_aarch64.app.tar.gz",
      dmg: "OpenHarness_1.2.3_arm64.dmg",
    },
    x86_64: {
      updater: "OpenHarness_1.2.3_x86_64.app.tar.gz",
      dmg: "OpenHarness_1.2.3_x64.dmg",
    },
  });
});

test("uses strict SemVer rules for release versions", () => {
  assert.deepEqual(parseReleaseVersion("0.1.0-beta.1"), {
    version: "0.1.0-beta.1",
    major: "0",
    minor: "1",
    patch: "0",
    prerelease: true,
  });
  assert.throws(() => parseReleaseVersion("0.1.0-beta.01"), /Invalid release version/);
  assert.throws(() => parseReleaseVersion("0.1.0-alpha.001"), /Invalid release version/);
  assert.equal(parseReleaseVersion("0.1.0-beta.9").version, "0.1.0-beta.9");
  assert.equal(parseReleaseVersion("0.1.0-beta.10").version, "0.1.0-beta.10");
  assert.equal(parseReleaseVersion("0.1.0-alpha.100").version, "0.1.0-alpha.100");
});

test("requires canonical UTC RFC 3339 publication dates", () => {
  const manifest = createUpdateManifest({
    version: "0.1.0-beta.2",
    assetVersion: "0.1.0",
    buildNumber: "43",
    tag: "v0.1.0-beta.2",
    repository: "MicroSpotlight/OpenHarness",
    pubDate: "2026-08-15T12:00:00Z",
    notes: "Signed update",
    signatures: { aarch64: signature, x86_64: signature },
    checksums: { aarch64: checksum, x86_64: checksum },
    sizes: { aarch64: 120_000_000, x86_64: 125_000_000 },
  });

  manifest.pub_date = "2026-08-15";
  assert.throws(() => validateUpdateManifest(manifest), /UTC RFC 3339/);
  manifest.pub_date = "2026-02-30T12:00:00Z";
  assert.throws(() => validateUpdateManifest(manifest), /UTC RFC 3339/);
});

test("rejects insecure release URLs and malformed checksums", () => {
  const manifest = createUpdateManifest({
    version: "0.1.0-beta.2",
    assetVersion: "0.1.0",
    buildNumber: "43",
    tag: "v0.1.0-beta.2",
    repository: "MicroSpotlight/OpenHarness",
    pubDate: "2026-08-15T12:00:00Z",
    notes: "Signed update",
    signatures: { aarch64: signature, x86_64: signature },
    checksums: { aarch64: checksum, x86_64: checksum },
    sizes: { aarch64: 120_000_000, x86_64: 125_000_000 },
  });

  manifest.platforms["darwin-aarch64"].url = "http://example.com/update.tar.gz";
  assert.throws(() => validateUpdateManifest(manifest), /must use HTTPS/);

  manifest.platforms["darwin-aarch64"].url = "https://example.com/update.tar.gz";
  manifest.downloads["darwin-x86_64"].sha256 = "bad";
  assert.throws(() => validateUpdateManifest(manifest), /lowercase SHA-256/);

  manifest.downloads["darwin-x86_64"].sha256 = checksum;
  manifest.downloads["darwin-x86_64"].size = 0;
  assert.throws(() => validateUpdateManifest(manifest), /positive integer/);

  manifest.downloads["darwin-x86_64"].size = 125_000_000;
  manifest.build_number = "0";
  assert.throws(() => validateUpdateManifest(manifest), /positive numeric build number/);
});
