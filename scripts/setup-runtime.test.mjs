import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_BUNDLED_PATH_LENGTH,
  incompatibleNativeArtifactPaths,
  nativePackagePaths,
  oversizedBundledPaths,
  requiredPortableRuntimeFiles,
  resolveRuntimeTarget,
} from "./setup-runtime.mjs";

test("resolves every supported release runtime", () => {
  assert.equal(resolveRuntimeTarget({ OPENHARNESS_RUNTIME_OS: "darwin", OPENHARNESS_RUNTIME_CPU: "arm64" }).key, "darwin-arm64");
  assert.equal(resolveRuntimeTarget({ OPENHARNESS_RUNTIME_OS: "macos", OPENHARNESS_RUNTIME_CPU: "x64" }).key, "darwin-x64");
  assert.equal(resolveRuntimeTarget({ OPENHARNESS_RUNTIME_OS: "linux", OPENHARNESS_RUNTIME_CPU: "x64" }).key, "linux-x64");
  assert.equal(resolveRuntimeTarget({ OPENHARNESS_RUNTIME_OS: "linux", OPENHARNESS_RUNTIME_CPU: "arm64" }).key, "linux-arm64");
  assert.equal(resolveRuntimeTarget({ OPENHARNESS_RUNTIME_OS: "windows", OPENHARNESS_RUNTIME_CPU: "x64" }).key, "win32-x64");
  assert.equal(resolveRuntimeTarget({ OPENHARNESS_RUNTIME_OS: "windows", OPENHARNESS_RUNTIME_CPU: "arm64" }).key, "win32-arm64");
});

test("rejects unsupported runtime targets", () => {
  assert.throws(
    () => resolveRuntimeTarget({ OPENHARNESS_RUNTIME_OS: "linux", OPENHARNESS_RUNTIME_CPU: "riscv64" }),
    /Unsupported runtime target/,
  );
});

test("excludes only musl artifacts from GNU Linux release runtimes", () => {
  assert.deepEqual(incompatibleNativeArtifactPaths({ os: "linux", cpu: "x64" }), [
    "@img/sharp-linuxmusl-x64",
    "@img/sharp-libvips-linuxmusl-x64",
    "@koromix/koffi-linux-x64/musl_x64",
  ]);
  assert.deepEqual(incompatibleNativeArtifactPaths({ os: "linux", cpu: "arm64" }), [
    "@img/sharp-linuxmusl-arm64",
    "@img/sharp-libvips-linuxmusl-arm64",
    "@koromix/koffi-linux-arm64/musl_arm64",
  ]);
  assert.deepEqual(incompatibleNativeArtifactPaths({ os: "darwin", cpu: "arm64" }), []);
  assert.deepEqual(incompatibleNativeArtifactPaths({ os: "win32", cpu: "x64" }), []);
});

test("requires the target-specific node-pty prebuild on every platform", () => {
  for (const target of [
    { os: "darwin", cpu: "arm64" },
    { os: "linux", cpu: "x64" },
    { os: "linux", cpu: "arm64" },
    { os: "win32", cpu: "x64" },
  ]) {
    assert.ok(
      nativePackagePaths(target).includes(`node-pty/prebuilds/${target.os}-${target.cpu}`),
    );
  }
});

test("rejects the nested runtime paths that abort the Windows installer", () => {
  // The tree that broke the v0.1.1-beta.0 Windows build: conflicting upstream
  // ranges made Bun nest node_modules until NSIS could no longer open a file.
  const nested =
    "node_modules/@deepseek-ai/dsh-client-locale/" +
    "node_modules/@deepseek-ai/dsh-api-remotes/" +
    "node_modules/@deepseek-ai/dsh-cordis-host-runner/" +
    "node_modules/@deepseek-ai/dsh-tools/" +
    "node_modules/@deepseek-ai/dsh-system-prompt/LICENSE";
  const flat = "node_modules/@deepseek-ai/dsh-system-prompt/LICENSE";

  assert.deepEqual(oversizedBundledPaths([flat]), []);
  assert.deepEqual(oversizedBundledPaths([flat, nested]), [nested]);
});

test("reports the longest offending bundled path first", () => {
  const longer = `node_modules/${"a".repeat(MAX_BUNDLED_PATH_LENGTH)}/index.js`;
  const shorter = `node_modules/${"b".repeat(MAX_BUNDLED_PATH_LENGTH - 10)}/index.js`;
  assert.deepEqual(oversizedBundledPaths([shorter, longer]), [longer, shorter]);
});

test("bundled path budget leaves room for the Windows installation prefix", () => {
  // Bundled from `<checkout>\src-tauri\runtime\dsh\` and installed under
  // `<programs>\OpenHarness\resources\runtime\dsh\`; the installed prefix is
  // the longer of the two because it carries the user's account name.
  const installPrefix =
    "C:\\Users\\a-fairly-long-account\\AppData\\Local\\OpenHarness\\resources\\runtime\\dsh\\";
  assert.ok(installPrefix.length + MAX_BUNDLED_PATH_LENGTH <= 260);
});

test("requires the plugin discovery and package manager runtime files", () => {
  assert.deepEqual(requiredPortableRuntimeFiles(), [
    "openharness.patch.yml",
    "openharness-find.patch.yml",
    "openharness-bin/pnpm",
    "openharness-bin/pnpm.cmd",
    "node_modules/pnpm/bin/pnpm.cjs",
    "node_modules/pnpm/bin/pnpm.mjs",
    "node_modules/pnpm/dist/pnpm.mjs",
    "node_modules/@openharness/native-bridge/lib/index.js",
    "node_modules/@openharness/native-bridge/lib/index.d.ts",
    "node_modules/@openharness/native-bridge/lib/managed-runtime.js",
    "node_modules/@openharness/native-bridge/lib/managed-runtime.d.ts",
    "node_modules/@microspotlight/openharness-find-plugin/lib/index.js",
    "node_modules/@microspotlight/openharness-find-plugin/lib/client.js",
    "node_modules/@microspotlight/openharness-find-plugin/cordis.patch.yml",
  ]);
});
