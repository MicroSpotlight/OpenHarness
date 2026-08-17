#!/usr/bin/env node

import { createHash } from "node:crypto";
import {
  chmod,
  copyFile,
  cp,
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const NODE_VERSION = "v24.19.0";
const PROJECT_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const RUNTIME_DIR = join(PROJECT_ROOT, "src-tauri", "runtime");
const DSH_DIR = join(RUNTIME_DIR, "dsh");
const MANIFEST_DIR = join(PROJECT_ROOT, "runtime");
const NODE_STAMP = join(RUNTIME_DIR, ".openharness-node-version");
const RUNTIME_STAMP = join(DSH_DIR, ".openharness-runtime.sha256");

const NODE_DISTRIBUTIONS = {
  "darwin-arm64": {
    archive: `node-${NODE_VERSION}-darwin-arm64.tar.gz`,
    sha256: "8294b7aa9b03997481c06babf1e8b270c859358f27da57a11509afe537ac381d",
  },
  "darwin-x64": {
    archive: `node-${NODE_VERSION}-darwin-x64.tar.gz`,
    sha256: "d1b5e999db158c62fe8f7267a4476b035d8bd93b1a605bac24a3f0dd166e3316",
  },
  "linux-x64": {
    archive: `node-${NODE_VERSION}-linux-x64.tar.xz`,
    sha256: "14b342e71204f811bde6153be8e04b62aef63c236fef92b55f9c83154b409647",
  },
  "linux-arm64": {
    archive: `node-${NODE_VERSION}-linux-arm64.tar.xz`,
    sha256: "01443c1e1a29e531ccad5a46fefa6df490d2189c49f7955904aecdbb0fe86fdc",
  },
  "win32-x64": {
    archive: `node-${NODE_VERSION}-win-x64.zip`,
    sha256: "57f71ab3652e797d84acddc79c81cc9ff1c6ddb2a1974cdb83f00fee9bff4c73",
  },
  "win32-arm64": {
    archive: `node-${NODE_VERSION}-win-arm64.zip`,
    sha256: "8502f4a50b458d4cc38ed8f2001556c2cd239d464920f74017926ccb1e1c157f",
  },
};

function normalizeTargetOs(value) {
  const aliases = { macos: "darwin", windows: "win32" };
  return aliases[value] ?? value;
}

export function resolveRuntimeTarget(environment = process.env, host = process) {
  const os = normalizeTargetOs(environment.OPENHARNESS_RUNTIME_OS || host.platform);
  const cpu = environment.OPENHARNESS_RUNTIME_CPU || host.arch;
  const key = `${os}-${cpu}`;
  if (!NODE_DISTRIBUTIONS[key]) {
    throw new Error(
      `Unsupported runtime target ${key}; supported targets: ${Object.keys(NODE_DISTRIBUTIONS).join(", ")}`,
    );
  }
  return { os, cpu, key, ...NODE_DISTRIBUTIONS[key] };
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: PROJECT_ROOT,
    encoding: "utf8",
    stdio: options.capture ? "pipe" : "inherit",
    ...options,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const details = options.capture ? `: ${(result.stderr || result.stdout).trim()}` : "";
    throw new Error(`${command} exited with code ${result.status}${details}`);
  }
  return options.capture ? result.stdout.trim() : "";
}

async function fileExists(path) {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

async function directoryExists(path) {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

async function download(url, output) {
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok) throw new Error(`Failed to download ${url}: HTTP ${response.status}`);
  await writeFile(output, Buffer.from(await response.arrayBuffer()));
}

async function sha256(path) {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

async function collectFiles(path) {
  const info = await stat(path);
  if (info.isFile()) return [path];
  const files = [];
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const child = join(path, entry.name);
    if (entry.isDirectory()) files.push(...(await collectFiles(child)));
    else if (entry.isFile()) files.push(child);
  }
  return files;
}

async function runtimeManifestHash(target, bunVersion) {
  const inputs = [
    join(MANIFEST_DIR, "package.json"),
    join(MANIFEST_DIR, "bun.lock"),
    join(MANIFEST_DIR, "openharness.patch.yml"),
    join(MANIFEST_DIR, "native-bridge"),
    join(PROJECT_ROOT, "scripts", "brand-runtime.mjs"),
    join(PROJECT_ROOT, "assets", "openharness-icon.png"),
  ];
  const files = (await Promise.all(inputs.map(collectFiles))).flat().sort();
  const hash = createHash("sha256");
  hash.update(`${NODE_VERSION}\0${target.key}\0${bunVersion}\0`);
  for (const file of files) {
    hash.update(`${relative(PROJECT_ROOT, file).replaceAll("\\", "/")}\0`);
    hash.update(await readFile(file));
    hash.update("\0");
  }
  return hash.digest("hex");
}

async function installNode(target) {
  const nodeName = target.os === "win32" ? "node.exe" : "node";
  const nodePath = join(RUNTIME_DIR, nodeName);
  const expectedStamp = `${NODE_VERSION}/${target.key}`;
  const installedStamp = await readFile(NODE_STAMP, "utf8").catch(() => "");
  if ((await fileExists(nodePath)) && installedStamp.trim() === expectedStamp) {
    if (target.os !== process.platform || target.cpu !== process.arch) {
      console.log(`>> Node ${expectedStamp} already installed`);
      return nodePath;
    }
    try {
      if (run(nodePath, ["--version"], { capture: true }) === NODE_VERSION) {
        console.log(`>> Node ${expectedStamp} already installed`);
        return nodePath;
      }
    } catch {
      console.warn(`>> Cached Node ${expectedStamp} failed validation; reinstalling`);
    }
  }

  await mkdir(RUNTIME_DIR, { recursive: true });
  await rm(join(RUNTIME_DIR, target.os === "win32" ? "node" : "node.exe"), { force: true });
  const downloadDir = await mkdtemp(join(tmpdir(), "openharness-node-"));
  try {
    const archivePath = join(downloadDir, target.archive);
    const url = `https://nodejs.org/dist/${NODE_VERSION}/${target.archive}`;
    console.log(`>> Downloading ${url}`);
    await download(url, archivePath);
    const actualHash = await sha256(archivePath);
    if (actualHash !== target.sha256) {
      throw new Error(`Node archive SHA-256 mismatch: expected ${target.sha256}, got ${actualHash}`);
    }
    run("tar", ["-xf", archivePath, "-C", downloadDir]);
    const distributionDir = join(downloadDir, basename(target.archive).replace(/\.(tar\.gz|tar\.xz|zip)$/, ""));
    const source = target.os === "win32"
      ? join(distributionDir, "node.exe")
      : join(distributionDir, "bin", "node");
    await copyFile(source, nodePath);
    if (target.os !== "win32") await chmod(nodePath, 0o755);
    await writeFile(NODE_STAMP, `${expectedStamp}\n`);
  } finally {
    await rm(downloadDir, { recursive: true, force: true });
  }
  return nodePath;
}

function nativePackagePaths(target) {
  const paths = [
    `@koromix/koffi-${target.os}-${target.cpu}`,
    `@vscode/ripgrep-${target.os}-${target.cpu}`,
  ];
  const requireBuiltinSuffix = target.os === "linux"
    ? `${target.os}-${target.cpu}-gnu`
    : target.os === "win32"
      ? `${target.os}-${target.cpu}-msvc`
      : `${target.os}-${target.cpu}`;
  paths.push(`node-addon-require-builtin-${requireBuiltinSuffix}`);
  if (target.os !== "linux") paths.push(`node-pty/prebuilds/${target.os}-${target.cpu}`);
  if (target.os === "darwin") {
    paths.push(`@img/sharp-darwin-${target.cpu}`, `@img/sharp-libvips-darwin-${target.cpu}`);
  } else if (target.os === "linux") {
    paths.push(
      `@deepseek-ai/node-addon-landlock-run-linux-${target.cpu}`,
      `@img/sharp-linux-${target.cpu}`,
      `@img/sharp-libvips-linux-${target.cpu}`,
    );
  } else {
    paths.push(`@img/sharp-win32-${target.cpu}`);
  }
  return paths;
}

export function incompatibleNativeArtifactPaths(target) {
  if (target.os !== "linux") return [];
  return [
    `@img/sharp-linuxmusl-${target.cpu}`,
    `@img/sharp-libvips-linuxmusl-${target.cpu}`,
    `@koromix/koffi-linux-${target.cpu}/musl_${target.cpu}`,
  ];
}

async function filterRuntimeForTarget(target) {
  // Bun filters optional dependencies by OS and CPU, but not by Linux libc.
  for (const packagePath of incompatibleNativeArtifactPaths(target)) {
    await rm(join(DSH_DIR, "node_modules", packagePath), { recursive: true, force: true });
  }
}

async function verifyRuntime(target, nodePath) {
  for (const packagePath of nativePackagePaths(target)) {
    const absolute = join(DSH_DIR, "node_modules", packagePath);
    if (!(await directoryExists(absolute)) || (await collectFiles(absolute)).length === 0) {
      throw new Error(`Bundled native package is missing for ${target.key}: ${packagePath}`);
    }
  }

  if (target.os === "linux" && target.os === process.platform && target.cpu === process.arch) {
    const linuxPty = join(DSH_DIR, "node_modules", "node-pty", "build", "Release", "pty.node");
    if (!(await fileExists(linuxPty))) {
      throw new Error("node-pty did not produce build/Release/pty.node on Linux");
    }
  }

  if (target.os === process.platform && target.cpu === process.arch) {
    const version = run(nodePath, ["--version"], { capture: true });
    if (version !== NODE_VERSION) throw new Error(`Expected Node ${NODE_VERSION}, got ${version}`);
    run(nodePath, ["-e", "require('node-pty'); require('sharp'); require('koffi')"], { cwd: DSH_DIR });
  } else {
    console.log(`>> Skipping execution of ${target.key} native modules on ${process.platform}-${process.arch}`);
  }
}

async function assembleDsh(target) {
  await rm(DSH_DIR, { recursive: true, force: true });
  await mkdir(DSH_DIR, { recursive: true });
  await copyFile(join(MANIFEST_DIR, "package.json"), join(DSH_DIR, "package.json"));
  await copyFile(join(MANIFEST_DIR, "bun.lock"), join(DSH_DIR, "bun.lock"));
  await copyFile(join(MANIFEST_DIR, "openharness.patch.yml"), join(DSH_DIR, "openharness.patch.yml"));
  await cp(join(MANIFEST_DIR, "native-bridge"), join(DSH_DIR, "native-bridge"), { recursive: true });
  console.log(`>> Installing DSH runtime for ${target.key}`);
  run("bun", [
    "install",
    "--production",
    "--frozen-lockfile",
    `--cpu=${target.cpu}`,
    `--os=${target.os}`,
    "--registry=https://registry.npmjs.org",
  ], { cwd: DSH_DIR });
}

async function finalizeDsh(target, nodePath, expectedHash) {
  await filterRuntimeForTarget(target);
  run("bun", ["scripts/brand-runtime.mjs"]);
  await verifyRuntime(target, nodePath);
  await writeFile(RUNTIME_STAMP, `${expectedHash}\n`);
}

async function installDsh(target, nodePath) {
  const bunVersion = run("bun", ["--version"], { capture: true });
  const expectedHash = await runtimeManifestHash(target, bunVersion);
  const installedHash = await readFile(RUNTIME_STAMP, "utf8").catch(() => "");
  const binPath = join(DSH_DIR, "node_modules", "@deepseek-ai", "dsh", "lib", "bin.js");
  const cacheMatches = (await fileExists(binPath)) && installedHash.trim() === expectedHash;

  if (cacheMatches) {
    console.log(`>> DSH runtime for ${target.key} matches the lockfile`);
  } else {
    await assembleDsh(target);
  }

  try {
    await finalizeDsh(target, nodePath, expectedHash);
  } catch (error) {
    await rm(RUNTIME_STAMP, { force: true });
    if (!cacheMatches) throw error;
    console.warn(`>> Cached DSH runtime for ${target.key} failed validation; rebuilding`);
    await assembleDsh(target);
    try {
      await finalizeDsh(target, nodePath, expectedHash);
    } catch (rebuildError) {
      await rm(RUNTIME_STAMP, { force: true });
      throw rebuildError;
    }
  }
}

async function main() {
  const target = resolveRuntimeTarget();
  console.log(`>> Assembling OpenHarness runtime for ${target.key}`);
  const nodePath = await installNode(target);
  await installDsh(target, nodePath);
  console.log(`>> Runtime ready: ${RUNTIME_DIR}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
