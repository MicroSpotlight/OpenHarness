import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const APPLE_BUILD_NUMBER_PATTERN = /^[1-9]\d{0,3}(?:\.\d{1,2}){0,2}$/;

export function requireAppleBuildNumber(value, label) {
  const buildNumber = typeof value === "string" ? value.trim() : "";
  if (!APPLE_BUILD_NUMBER_PATTERN.test(buildNumber)) {
    throw new Error(`${label} must be a valid positive macOS CFBundleVersion`);
  }
  return buildNumber;
}

export function resolveBuildNumber(configuredBuildNumber, providedBuildNumber) {
  if (providedBuildNumber?.trim()) {
    return requireAppleBuildNumber(providedBuildNumber, "Provided build number");
  }

  const configured = requireAppleBuildNumber(configuredBuildNumber, "Configured build number");
  if (!/^\d+$/.test(configured)) {
    throw new Error("Configured build number must be a single integer to support automatic incrementing");
  }
  const next = Number(configured) + 1;
  if (!Number.isSafeInteger(next) || next > 9_999) {
    throw new Error("Configured build number cannot be incremented within macOS CFBundleVersion limits");
  }
  return String(next);
}

export function buildTauriArguments(args, configOverride) {
  const commandArguments = [...args];
  const runnerArgumentsIndex = commandArguments.indexOf("--");
  commandArguments.splice(
    runnerArgumentsIndex === -1 ? commandArguments.length : runnerArgumentsIndex,
    0,
    "--config",
    configOverride,
  );
  return commandArguments;
}

async function main(args) {
  const config = JSON.parse(
    await readFile(new URL("../src-tauri/tauri.conf.json", import.meta.url), "utf8"),
  );
  const providedBuildNumber =
    process.env.OPENHARNESS_BUILD_NUMBER?.trim() || process.env.GITHUB_RUN_NUMBER?.trim();
  const buildNumber = resolveBuildNumber(
    config.bundle?.macOS?.bundleVersion,
    providedBuildNumber,
  );
  const configOverride = JSON.stringify({
    bundle: { macOS: { bundleVersion: buildNumber } },
  });

  console.log(`Building OpenHarness with build number ${buildNumber}`);
  const commandArguments = buildTauriArguments(args, configOverride);
  const child = spawn(
    "bun",
    ["run", "tauri", "build", ...commandArguments],
    {
      stdio: "inherit",
      env: { ...process.env, OPENHARNESS_BUILD_NUMBER: buildNumber },
    },
  );
  await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (signal) reject(new Error(`Tauri build terminated by ${signal}`));
      else if (code === 0) resolve();
      else reject(new Error(`Tauri build exited with code ${code ?? "unknown"}`));
    });
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
