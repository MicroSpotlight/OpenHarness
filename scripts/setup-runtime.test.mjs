import assert from "node:assert/strict";
import test from "node:test";

import {
  incompatibleNativeArtifactPaths,
  nativePackagePaths,
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
