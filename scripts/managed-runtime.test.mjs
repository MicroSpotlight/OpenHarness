import assert from "node:assert/strict";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import test from "node:test";

import {
  MANAGED_RESTART_EXIT_CODE,
  ManagedRuntimeExecutor,
  readManagedRuntimeEnvironment,
} from "../runtime/native-bridge/lib/managed-runtime.js";

function temporaryRuntime(t) {
  const root = mkdtempSync(join(tmpdir(), "openharness-managed-runtime-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const runtimeRoot = join(root, "runtime");
  const dshHome = join(root, "dsh-home");
  const profileDirectory = join(dshHome, "profiles", "web");
  const packageManagerBinDirectory = join(runtimeRoot, "dsh", "openharness-bin");
  const dshEntry = join(runtimeRoot, "dsh", "fake-dsh.mjs");
  mkdirSync(packageManagerBinDirectory, { recursive: true });
  mkdirSync(dshHome, { recursive: true });
  const launcher = join(
    packageManagerBinDirectory,
    process.platform === "win32" ? "pnpm.cmd" : "pnpm",
  );
  writeFileSync(launcher, process.platform === "win32" ? "@echo off\r\n" : "#!/bin/sh\n");
  if (process.platform !== "win32") chmodSync(launcher, 0o755);
  writeFileSync(
    dshEntry,
    `
      import { spawn } from "node:child_process";
      import { writeFileSync } from "node:fs";

      const args = process.argv.slice(2);
      if (args.includes("large-output")) {
        process.stdout.write(Buffer.alloc(300 * 1024, 65));
      } else if (args.includes("wait")) {
        const marker = process.env.OPENHARNESS_TEST_DESCENDANT_PID;
        if (marker) {
          const descendant = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
            stdio: "ignore",
          });
          writeFileSync(marker, String(descendant.pid));
        }
        setInterval(() => {}, 1000);
      } else {
        process.stdout.write(JSON.stringify({
          args,
          dshHome: process.env.DSH_HOME,
          ignoreScripts: process.env.npm_config_ignore_scripts,
          path: process.env.PATH,
          pnpmSelfUpdateCheck: process.env.PNPM_DISABLE_SELF_UPDATE_CHECK,
        }));
      }
    `,
  );
  return {
    root,
    runtimeRoot,
    dshHome,
    profileDirectory,
    nodePath: process.execPath,
    dshEntry,
    packageManagerBinDirectory,
    packageManagerLauncher: launcher,
    profileName: "web",
    protocolVersion: 1,
    restartExitCode: MANAGED_RESTART_EXIT_CODE,
  };
}

function managedEnvironment(configuration) {
  return {
    OPENHARNESS_MANAGED_RUNTIME: "1",
    OPENHARNESS_MANAGED_RUNTIME_PROTOCOL: "1",
    OPENHARNESS_PROFILE_NAME: configuration.profileName,
    OPENHARNESS_PROFILE_DIRECTORY: configuration.profileDirectory,
    OPENHARNESS_RUNTIME_ROOT: configuration.runtimeRoot,
    OPENHARNESS_NODE_PATH: join(configuration.runtimeRoot, "node"),
    OPENHARNESS_DSH_ENTRY: configuration.dshEntry,
    OPENHARNESS_PACKAGE_MANAGER_BIN: configuration.packageManagerBinDirectory,
    OPENHARNESS_RESTART_EXIT_CODE: String(MANAGED_RESTART_EXIT_CODE),
    DSH_HOME: configuration.dshHome,
  };
}

async function waitForProcessExit(pid) {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0);
    } catch {
      return;
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 20));
  }
  assert.fail(`process ${pid} remained alive after cancellation`);
}

test("managed environment is opt-in and validates its path boundaries", (t) => {
  const configuration = temporaryRuntime(t);
  assert.equal(readManagedRuntimeEnvironment({}), undefined);

  const parsed = readManagedRuntimeEnvironment(managedEnvironment(configuration));
  assert.equal(parsed.profileName, "web");
  assert.equal(parsed.profileDirectory, configuration.profileDirectory);

  assert.throws(
    () =>
      readManagedRuntimeEnvironment({
        ...managedEnvironment(configuration),
        OPENHARNESS_MANAGED_RUNTIME_PROTOCOL: "1-extra",
      }),
    { code: "RUNTIME_NOT_READY" },
  );
  assert.throws(
    () =>
      readManagedRuntimeEnvironment({
        ...managedEnvironment(configuration),
        OPENHARNESS_DSH_ENTRY: join(configuration.root, "outside.mjs"),
      }),
    { code: "RUNTIME_NOT_READY" },
  );
});

test("executor uses fixed DSH and profile arguments with managed PATH first", async (t) => {
  const configuration = temporaryRuntime(t);
  const executor = new ManagedRuntimeExecutor(configuration, {
    environment: { PATH: "/user/bin" },
  });

  assert.deepEqual(await executor.probe(), { ready: true });
  const progressEvents = [];
  const result = await executor.run(
    ["--profile", "web", "add", "--save-exact", "example-plugin@1.2.3"],
    {
      signal: new AbortController().signal,
      onProgress: (event) => progressEvents.push(event),
    },
  );
  assert.equal(result.exitCode, 0);
  const output = JSON.parse(result.stdout);
  assert.deepEqual(output.args, [
    "plugin",
    "--profile",
    "web",
    "add",
    "--save-exact",
    "example-plugin@1.2.3",
  ]);
  assert.equal(output.dshHome, configuration.dshHome);
  assert.equal(output.ignoreScripts, "true");
  assert.equal(output.path.split(delimiter)[0], configuration.packageManagerBinDirectory);
  assert.equal(output.pnpmSelfUpdateCheck, "1");
  assert.deepEqual(progressEvents, [{ phase: "resolving" }]);
});

test("executor rejects unsupported commands and concurrent operations", async (t) => {
  const configuration = temporaryRuntime(t);
  const executor = new ManagedRuntimeExecutor(configuration);
  const options = () => ({
    signal: new AbortController().signal,
    onProgress: () => {},
  });
  assert.throws(
    () => executor.run(["remove", "example-plugin"], options()),
    { code: "INVALID_OPERATION" },
  );
  assert.throws(
    () => executor.run(["--profile", "other", "install"], options()),
    { code: "INVALID_OPERATION" },
  );
  assert.throws(
    () => executor.run(["--profile", "web", "install"], undefined),
    { code: "INVALID_OPERATION" },
  );

  const controller = new AbortController();
  const active = executor.run(
    ["--profile", "web", "add", "--save-exact", "wait"],
    { signal: controller.signal, onProgress: () => {} },
  );
  assert.throws(
    () => executor.run(["--profile", "web", "install"], options()),
    { code: "OPERATION_BUSY" },
  );
  controller.abort();
  await assert.rejects(active, { code: "OPERATION_CANCELLED" });
});

test("executor terminates the process tree when cancelled", { skip: process.platform === "win32" }, async (t) => {
  const configuration = temporaryRuntime(t);
  const marker = join(configuration.root, "descendant.pid");
  const executor = new ManagedRuntimeExecutor(configuration, {
    environment: {
      ...process.env,
      OPENHARNESS_TEST_DESCENDANT_PID: marker,
    },
  });
  const controller = new AbortController();
  const active = executor.run(
    ["--profile", "web", "add", "--save-exact", "wait"],
    { signal: controller.signal, onProgress: () => {} },
  );

  let descendantPid;
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    try {
      descendantPid = Number.parseInt(readFileSync(marker, "utf8"), 10);
      break;
    } catch {
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 20));
    }
  }
  assert.ok(Number.isInteger(descendantPid));
  controller.abort();
  await assert.rejects(active, { code: "OPERATION_CANCELLED" });
  await waitForProcessExit(descendantPid);
});

test("executor bounds output and schedules the managed restart code", async (t) => {
  const configuration = temporaryRuntime(t);
  let exitCode;
  const executor = new ManagedRuntimeExecutor(configuration, {
    exitProcess: (value) => {
      exitCode = value;
    },
  });

  await assert.rejects(
    executor.run(
      ["--profile", "web", "add", "--save-exact", "large-output"],
      { signal: new AbortController().signal, onProgress: () => {} },
    ),
    { code: "OUTPUT_LIMIT_EXCEEDED" },
  );
  executor.restart();
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 300));
  assert.equal(exitCode, MANAGED_RESTART_EXIT_CODE);
});

test("executor enforces a host-side timeout", async (t) => {
  const configuration = temporaryRuntime(t);
  const executor = new ManagedRuntimeExecutor(configuration, { operationTimeoutMs: 20 });

  await assert.rejects(
    executor.run(
      ["--profile", "web", "add", "--save-exact", "wait"],
      { signal: new AbortController().signal, onProgress: () => {} },
    ),
    { code: "OPERATION_TIMEOUT" },
  );
});
