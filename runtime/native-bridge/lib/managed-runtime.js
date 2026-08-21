import { access, readFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { delimiter, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { spawn } from "node:child_process";

export const MANAGED_RUNTIME_PROTOCOL_VERSION = 1;
export const MANAGED_RUNTIME_SERVICE_NAME = "openharnessPluginRuntime";
export const MANAGED_RESTART_EXIT_CODE = 75;

const STDOUT_LIMIT = 256 * 1024;
const STDERR_LIMIT = 64 * 1024;
const MAX_OPERATION_DURATION_MS = 10 * 60 * 1_000;
const PROFILE_STARTUP_TIMEOUT_MS = 30 * 1_000;
const MAX_ARGUMENTS = 64;
const MAX_ARGUMENT_BYTES = 32 * 1024;
const FIND_PLUGIN_PACKAGE = "@microspotlight/openharness-find-plugin";

export class ManagedRuntimeError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "ManagedRuntimeError";
    this.code = code;
  }
}

function requiredEnvironmentValue(environment, key) {
  const value = environment[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new ManagedRuntimeError("RUNTIME_NOT_READY", `managed runtime is missing ${key}`);
  }
  return value;
}

function requireAbsolutePath(environment, key) {
  const value = requiredEnvironmentValue(environment, key);
  if (!isAbsolute(value)) {
    throw new ManagedRuntimeError("RUNTIME_NOT_READY", `${key} must be an absolute path`);
  }
  return resolve(value);
}

function isWithin(root, target) {
  const remainder = relative(root, target);
  return remainder === "" || (!remainder.startsWith("..") && !isAbsolute(remainder));
}

export function readManagedRuntimeEnvironment(
  environment = process.env,
  platform = process.platform,
) {
  if (environment.OPENHARNESS_MANAGED_RUNTIME !== "1") return undefined;

  const protocol = requiredEnvironmentValue(
    environment,
    "OPENHARNESS_MANAGED_RUNTIME_PROTOCOL",
  );
  if (protocol !== String(MANAGED_RUNTIME_PROTOCOL_VERSION)) {
    throw new ManagedRuntimeError("RUNTIME_NOT_READY", "unsupported managed runtime protocol");
  }
  const protocolVersion = MANAGED_RUNTIME_PROTOCOL_VERSION;

  const profileName = requiredEnvironmentValue(environment, "OPENHARNESS_PROFILE_NAME");
  if (!/^[a-z][a-z0-9-]{0,63}$/.test(profileName)) {
    throw new ManagedRuntimeError("RUNTIME_NOT_READY", "managed profile name is invalid");
  }

  const runtimeRoot = requireAbsolutePath(environment, "OPENHARNESS_RUNTIME_ROOT");
  const dshHome = requireAbsolutePath(environment, "DSH_HOME");
  const profileDirectory = requireAbsolutePath(environment, "OPENHARNESS_PROFILE_DIRECTORY");
  const nodePath = requireAbsolutePath(environment, "OPENHARNESS_NODE_PATH");
  const dshEntry = requireAbsolutePath(environment, "OPENHARNESS_DSH_ENTRY");
  const packageManagerBinDirectory = requireAbsolutePath(
    environment,
    "OPENHARNESS_PACKAGE_MANAGER_BIN",
  );
  const patchPath = requireAbsolutePath(environment, "OPENHARNESS_PATCH_PATH");
  const findPluginPatchPath = requireAbsolutePath(
    environment,
    "OPENHARNESS_FIND_PLUGIN_PATCH_PATH",
  );
  const expectedProfileDirectory = resolve(dshHome, "profiles", profileName);

  if (profileDirectory !== expectedProfileDirectory) {
    throw new ManagedRuntimeError("RUNTIME_NOT_READY", "managed profile directory is inconsistent");
  }
  for (const path of [
    nodePath,
    dshEntry,
    packageManagerBinDirectory,
    patchPath,
    findPluginPatchPath,
  ]) {
    if (!isWithin(runtimeRoot, path)) {
      throw new ManagedRuntimeError("RUNTIME_NOT_READY", "managed executable escaped runtime root");
    }
  }

  const restartCode = requiredEnvironmentValue(environment, "OPENHARNESS_RESTART_EXIT_CODE");
  if (restartCode !== String(MANAGED_RESTART_EXIT_CODE)) {
    throw new ManagedRuntimeError("RUNTIME_NOT_READY", "managed restart protocol is invalid");
  }
  const restartExitCode = MANAGED_RESTART_EXIT_CODE;

  return Object.freeze({
    protocolVersion,
    profileName,
    profileDirectory,
    dshHome,
    runtimeRoot,
    nodePath,
    dshEntry,
    patchPath,
    findPluginPatchPath,
    packageManagerBinDirectory,
    packageManagerLauncher: join(
      packageManagerBinDirectory,
      platform === "win32" ? "pnpm.cmd" : "pnpm",
    ),
    restartExitCode,
  });
}

function validateArguments(args, profileName) {
  if (!Array.isArray(args) || args.length === 0 || args.length > MAX_ARGUMENTS) {
    throw new ManagedRuntimeError("INVALID_OPERATION", "plugin command arguments are invalid");
  }
  let bytes = 0;
  for (const argument of args) {
    if (typeof argument !== "string" || argument.length === 0 || argument.includes("\0")) {
      throw new ManagedRuntimeError("INVALID_OPERATION", "plugin command argument is invalid");
    }
    bytes += Buffer.byteLength(argument);
  }
  const installsProfile =
    args.length === 3 &&
    args[0] === "--profile" &&
    args[1] === profileName &&
    args[2] === "install";
  const addsExactPackage =
    args.length === 5 &&
    args[0] === "--profile" &&
    args[1] === profileName &&
    args[2] === "add" &&
    args[3] === "--save-exact" &&
    !args[4].startsWith("-");
  if (bytes > MAX_ARGUMENT_BYTES || (!installsProfile && !addsExactPackage)) {
    throw new ManagedRuntimeError("INVALID_OPERATION", "plugin command is not allowed");
  }
}

function validateAbortSignal(signal) {
  if (
    signal === undefined ||
    typeof signal.aborted !== "boolean" ||
    typeof signal.addEventListener !== "function" ||
    typeof signal.removeEventListener !== "function"
  ) {
    throw new ManagedRuntimeError("INVALID_OPERATION", "an AbortSignal is required");
  }
}

function validateRunOptions(options) {
  if (options === null || typeof options !== "object") {
    throw new ManagedRuntimeError("INVALID_OPERATION", "plugin command options are invalid");
  }
  validateAbortSignal(options.signal);
  if (typeof options.onProgress !== "function") {
    throw new ManagedRuntimeError("INVALID_OPERATION", "a progress callback is required");
  }
}

function reportProgress(listener, event) {
  try {
    listener(event);
  } catch (error) {
    const warning = error instanceof Error ? error : new Error(String(error));
    process.emitWarning(warning, { code: "OPENHARNESS_RUNTIME_PROGRESS_LISTENER" });
  }
}

function reportPackageOutputProgress(chunk, listener) {
  const text = Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk);
  if (/download|fetch|resolve/i.test(text)) {
    reportProgress(listener, { phase: "downloading" });
  } else if (/link|install|added|package/i.test(text)) {
    reportProgress(listener, { phase: "linking" });
  }
}

function executableEnvironment(configuration, inheritedEnvironment) {
  const existingPath = inheritedEnvironment.PATH ?? inheritedEnvironment.Path ?? "";
  const path = [
    configuration.packageManagerBinDirectory,
    dirname(configuration.nodePath),
    existingPath,
  ]
    .filter(Boolean)
    .join(delimiter);
  const environment = { ...inheritedEnvironment };
  for (const key of Object.keys(environment)) {
    if (key.toUpperCase() === "PATH") delete environment[key];
  }
  return {
    ...environment,
    PATH: path,
    DSH_HOME: configuration.dshHome,
    CI: "1",
    COREPACK_ENABLE_DOWNLOAD_PROMPT: "0",
    NO_UPDATE_NOTIFIER: "1",
    PNPM_DISABLE_SELF_UPDATE_CHECK: "1",
    npm_config_ignore_scripts: "true",
  };
}

function terminateProcessTree(child, platform, spawnProcess, force = false) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  if (platform === "win32") {
    const killer = spawnProcess(
      "taskkill.exe",
      ["/PID", String(child.pid), "/T", "/F"],
      { stdio: "ignore", windowsHide: true, shell: false },
    );
    killer.unref();
    return;
  }

  if (force) {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {
      child.kill("SIGKILL");
    }
    return;
  }

  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    child.kill("SIGTERM");
  }
  const hardKill = setTimeout(() => {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {
      child.kill("SIGKILL");
    }
  }, 1_000);
  hardKill.unref();
  child.once("close", () => clearTimeout(hardKill));
}

function appendBounded(chunks, currentBytes, chunk, limit) {
  const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
  const remaining = limit - currentBytes;
  if (value.length > remaining) return { bytes: currentBytes, overflowed: true };
  chunks.push(value);
  return { bytes: currentBytes + value.length, overflowed: false };
}

function isPluginAdd(args, profileName) {
  return (
    args.length === 5 &&
    args[0] === "--profile" &&
    args[1] === profileName &&
    args[2] === "add" &&
    args[3] === "--save-exact"
  );
}

async function profileStartupArguments(configuration) {
  let hasFindPlugin = false;
  try {
    const manifest = JSON.parse(
      await readFile(join(configuration.profileDirectory, "package.json"), "utf8"),
    );
    hasFindPlugin = manifest?.dsh?.profile?.bundles?.includes(FIND_PLUGIN_PACKAGE) === true;
  } catch {
    // Let DSH report the invalid or missing profile with its normal startup error.
  }
  return [
    "--profile",
    configuration.profileName,
    "--patch",
    configuration.patchPath,
    ...(hasFindPlugin ? [] : ["--patch", configuration.findPluginPatchPath]),
    "--port",
    "0",
  ];
}

function containsLoopbackStartupUrl(output) {
  const marker = "dsh web: ";
  const start = output.indexOf(marker);
  if (start === -1) return false;
  const candidate = output.slice(start + marker.length).split(/\s/, 1)[0];
  try {
    const url = new URL(candidate);
    return (
      url.protocol === "http:" &&
      url.port !== "" &&
      url.username === "" &&
      url.password === "" &&
      (url.hostname === "localhost" ||
        url.hostname === "127.0.0.1" ||
        url.hostname === "[::1]")
    );
  } catch {
    return false;
  }
}

async function probeProfileStartup(configuration, options) {
  const { active, environment, platform, spawnProcess } = options;
  if (active.error !== undefined) throw active.error;

  const args = await profileStartupArguments(configuration);
  if (active.error !== undefined) throw active.error;

  let child;
  try {
    child = spawnProcess(configuration.nodePath, [configuration.dshEntry, ...args], {
      cwd: configuration.dshHome,
      env: executableEnvironment(configuration, environment),
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
      detached: platform !== "win32",
      windowsHide: true,
    });
  } catch {
    return { ready: false, detail: "failed to start the updated profile" };
  }
  active.child = child;

  return new Promise((resolveResult) => {
    const stdout = [];
    const stderr = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let startupReady = false;
    let outputExceeded = false;
    let timedOut = false;

    const timeout = setTimeout(() => {
      timedOut = true;
      terminateProcessTree(child, platform, spawnProcess);
    }, PROFILE_STARTUP_TIMEOUT_MS);
    timeout.unref();

    child.stdout.on("data", (chunk) => {
      const result = appendBounded(stdout, stdoutBytes, chunk, STDERR_LIMIT);
      stdoutBytes = result.bytes;
      if (result.overflowed) {
        outputExceeded = true;
        terminateProcessTree(child, platform, spawnProcess);
        return;
      }
      if (!startupReady && containsLoopbackStartupUrl(Buffer.concat(stdout).toString("utf8"))) {
        startupReady = true;
        terminateProcessTree(child, platform, spawnProcess);
      }
    });
    child.stderr.on("data", (chunk) => {
      const result = appendBounded(stderr, stderrBytes, chunk, STDERR_LIMIT);
      stderrBytes = result.bytes;
      if (result.overflowed) {
        outputExceeded = true;
        terminateProcessTree(child, platform, spawnProcess);
      }
    });
    child.once("error", () => {
      clearTimeout(timeout);
      resolveResult({ ready: false, detail: "failed to start the updated profile" });
    });
    child.once("close", (exitCode, exitSignal) => {
      clearTimeout(timeout);
      if (startupReady) {
        resolveResult({ ready: true });
        return;
      }
      const detail = Buffer.concat(stderr).toString("utf8").trim() ||
        Buffer.concat(stdout).toString("utf8").trim();
      resolveResult({
        ready: false,
        detail: outputExceeded
          ? "updated profile startup output exceeded the safety limit"
          : timedOut
            ? "updated profile did not start within 30 seconds"
            : detail ||
              `updated profile exited before startup (${exitCode ?? exitSignal ?? "unknown"})`,
      });
    });
  });
}

export class ManagedRuntimeExecutor {
  constructor(configuration, options = {}) {
    this.configuration = configuration;
    this.platform = options.platform ?? process.platform;
    this.spawnProcess = options.spawnProcess ?? spawn;
    this.inheritedEnvironment = options.environment ?? process.env;
    this.exitProcess = options.exitProcess ?? ((code) => process.exit(code));
    this.operationTimeoutMs = options.operationTimeoutMs ?? MAX_OPERATION_DURATION_MS;
    this.active = undefined;
    this.restartScheduled = false;
  }

  get currentProfile() {
    return Object.freeze({
      name: this.configuration.profileName,
      directory: this.configuration.profileDirectory,
    });
  }

  async probe() {
    try {
      const executableMode = this.platform === "win32" ? fsConstants.F_OK : fsConstants.X_OK;
      await Promise.all([
        access(this.configuration.nodePath, executableMode),
        access(this.configuration.dshEntry, fsConstants.R_OK),
        access(this.configuration.packageManagerLauncher, executableMode),
      ]);
      return { ready: true };
    } catch {
      return { ready: false, reason: "bundled Node, DSH, or pnpm is unavailable" };
    }
  }

  run(args, options) {
    validateArguments(args, this.configuration.profileName);
    validateRunOptions(options);
    const { signal, onProgress } = options;
    if (this.active !== undefined) {
      throw new ManagedRuntimeError("OPERATION_BUSY", "a package operation is already running");
    }
    if (signal.aborted) {
      throw new ManagedRuntimeError("OPERATION_CANCELLED", "package operation was cancelled");
    }

    let child;
    try {
      child = this.spawnProcess(
        this.configuration.nodePath,
        [
          this.configuration.dshEntry,
          "plugin",
          ...args,
        ],
        {
          cwd: this.configuration.dshHome,
          env: executableEnvironment(this.configuration, this.inheritedEnvironment),
          stdio: ["ignore", "pipe", "pipe"],
          shell: false,
          detached: this.platform !== "win32",
          windowsHide: true,
        },
      );
    } catch {
      throw new ManagedRuntimeError(
        "RUNTIME_NOT_READY",
        "failed to start the package operation",
      );
    }

    const active = { child, error: undefined };
    this.active = active;
    reportProgress(onProgress, { phase: "resolving" });
    const stdout = [];
    const stderr = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;

    return new Promise((resolveResult, rejectResult) => {
      const failAndTerminate = (error) => {
        if (active.error !== undefined) return;
        active.error = error;
        terminateProcessTree(active.child, this.platform, this.spawnProcess);
      };
      const onAbort = () => {
        failAndTerminate(
          new ManagedRuntimeError("OPERATION_CANCELLED", "package operation was cancelled"),
        );
      };
      const timeout = setTimeout(() => {
        failAndTerminate(
          new ManagedRuntimeError("OPERATION_TIMEOUT", "package operation timed out"),
        );
      }, this.operationTimeoutMs);
      timeout.unref();
      signal.addEventListener("abort", onAbort, { once: true });

      child.stdout.on("data", (chunk) => {
        const result = appendBounded(stdout, stdoutBytes, chunk, STDOUT_LIMIT);
        stdoutBytes = result.bytes;
        if (result.overflowed) {
          failAndTerminate(
            new ManagedRuntimeError(
              "OUTPUT_LIMIT_EXCEEDED",
              "package operation output is too large",
            ),
          );
        } else reportPackageOutputProgress(chunk, onProgress);
      });
      child.stderr.on("data", (chunk) => {
        const result = appendBounded(stderr, stderrBytes, chunk, STDERR_LIMIT);
        stderrBytes = result.bytes;
        if (result.overflowed) {
          failAndTerminate(
            new ManagedRuntimeError(
              "OUTPUT_LIMIT_EXCEEDED",
              "package operation output is too large",
            ),
          );
        } else reportPackageOutputProgress(chunk, onProgress);
      });
      child.once("error", () => {
        active.error ??= new ManagedRuntimeError(
          "RUNTIME_NOT_READY",
          "failed to start the package operation",
        );
      });
      child.once("close", async (exitCode, exitSignal) => {
        if (active.error !== undefined) {
          clearTimeout(timeout);
          signal.removeEventListener("abort", onAbort);
          this.active = undefined;
          rejectResult(active.error);
          return;
        }
        const result = {
          exitCode: exitCode ?? (exitSignal === null ? 1 : 128),
          stdout: Buffer.concat(stdout).toString("utf8"),
          stderr: Buffer.concat(stderr).toString("utf8"),
        };
        if (result.exitCode === 0 && isPluginAdd(args, this.configuration.profileName)) {
          reportProgress(onProgress, { phase: "verifying" });
          try {
            const startup = await probeProfileStartup(this.configuration, {
              active,
              environment: this.inheritedEnvironment,
              platform: this.platform,
              spawnProcess: this.spawnProcess,
            });
            if (!startup.ready) {
              result.exitCode = 1;
              result.stderr = [
                result.stderr.trim(),
                `OpenHarness startup check failed: ${startup.detail}`,
              ].filter(Boolean).join("\n");
            }
          } catch (error) {
            active.error ??= error instanceof ManagedRuntimeError
              ? error
              : new ManagedRuntimeError("RUNTIME_NOT_READY", "profile startup check failed");
          }
        }
        clearTimeout(timeout);
        signal.removeEventListener("abort", onAbort);
        this.active = undefined;
        if (active.error !== undefined) rejectResult(active.error);
        else resolveResult(result);
      });
    });
  }

  restart() {
    if (this.active !== undefined) {
      throw new ManagedRuntimeError("OPERATION_BUSY", "cannot restart during a package operation");
    }
    if (this.restartScheduled) return;
    this.restartScheduled = true;
    const timer = setTimeout(() => this.exitProcess(this.configuration.restartExitCode), 250);
    timer.unref();
  }

  dispose(force = false) {
    if (this.active === undefined) return;
    this.active.error ??= new ManagedRuntimeError(
      "OPERATION_CANCELLED",
      "package operation was cancelled because its host stopped",
    );
    terminateProcessTree(this.active.child, this.platform, this.spawnProcess, force);
  }
}
