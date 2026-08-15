import assert from "node:assert/strict";
import test from "node:test";

import {
  buildTauriArguments,
  requireAppleBuildNumber,
  resolveBuildNumber,
} from "./build-tauri.mjs";

test("uses an externally supplied build number without changing it", () => {
  assert.equal(resolveBuildNumber("7", "42"), "42");
  assert.equal(resolveBuildNumber("7", "42.1"), "42.1");
});

test("increments the configured build number when no external number exists", () => {
  assert.equal(resolveBuildNumber("7"), "8");
  assert.equal(resolveBuildNumber("99"), "100");
});

test("rejects invalid or exhausted build numbers", () => {
  assert.throws(() => resolveBuildNumber("7", "001"), /valid positive macOS/);
  assert.throws(() => resolveBuildNumber("1.2"), /single integer/);
  assert.throws(() => resolveBuildNumber("9999"), /cannot be incremented/);
  assert.throws(() => requireAppleBuildNumber("0", "build"), /valid positive macOS/);
});

test("inserts the build-number override before runner arguments", () => {
  assert.deepEqual(buildTauriArguments(["--bundles", "app"], "override"), [
    "--bundles",
    "app",
    "--config",
    "override",
  ]);
  assert.deepEqual(buildTauriArguments(["--bundles", "app", "--", "--locked"], "override"), [
    "--bundles",
    "app",
    "--config",
    "override",
    "--",
    "--locked",
  ]);
});
