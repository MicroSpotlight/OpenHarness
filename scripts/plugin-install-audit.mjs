#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const TERMINAL_STATES = new Set(["completed", "failed", "cancelled"]);
const SNAPSHOT_FILES = [
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "cordis.patch.yml",
];
const POLL_INTERVAL_MS = 250;
const OPERATION_TIMEOUT_MS = 12 * 60 * 1_000;

function requiredEnvironment(name) {
  const value = process.env[name];
  if (!value) throw new Error(`missing ${name}`);
  return value;
}

const baseUrl = new URL(requiredEnvironment("OPENHARNESS_PLUGIN_AUDIT_URL"));
const dshHome = requiredEnvironment("DSH_HOME");
const limit = Number.parseInt(process.argv[2] ?? "20", 10);
const outputPath = process.argv[3];

if (process.env.OPENHARNESS_PLUGIN_AUDIT_ALLOW !== "1") {
  throw new Error("set OPENHARNESS_PLUGIN_AUDIT_ALLOW=1 to run the destructive audit");
}
const auditRootPrefix = join(resolve(tmpdir()), "openharness-plugin-audit.");
if (!resolve(dshHome).startsWith(auditRootPrefix)) {
  throw new Error(`plugin audit DSH_HOME must be an isolated ${auditRootPrefix}* path`);
}
if (baseUrl.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(baseUrl.hostname)) {
  throw new Error("plugin audit URL must use a loopback HTTP origin");
}
if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
  throw new Error("plugin audit limit must be an integer from 1 through 100");
}

async function request(path, options = {}) {
  const response = await fetch(new URL(path, baseUrl), options);
  const body = await response.json();
  if (!response.ok) {
    throw new Error(`${response.status} ${JSON.stringify(body)}`);
  }
  return body;
}

async function optionalRead(path) {
  try {
    return await readFile(path);
  } catch (error) {
    if (error.code === "ENOENT") return undefined;
    throw error;
  }
}

async function snapshot(profileDirectory) {
  return Promise.all(
    SNAPSHOT_FILES.map(async (name) => ({
      name,
      contents: await optionalRead(join(profileDirectory, name)),
    })),
  );
}

function snapshotDigest(files) {
  const hash = createHash("sha256");
  for (const file of files) {
    hash.update(file.name);
    hash.update(file.contents ?? Buffer.from("<missing>"));
  }
  return hash.digest("hex");
}

async function restoreSnapshot(profileDirectory, files) {
  for (const file of files) {
    const path = join(profileDirectory, file.name);
    if (file.contents === undefined) await rm(path, { force: true });
    else await writeFile(path, file.contents);
  }
}

async function resetProfile(profileDirectory, baseline, baselineDigest) {
  await restoreSnapshot(profileDirectory, baseline);
  await rm(join(profileDirectory, "node_modules"), { recursive: true, force: true });
  const restoredDigest = snapshotDigest(await snapshot(profileDirectory));
  if (restoredDigest !== baselineDigest) {
    throw new Error("profile metadata differs from the audit baseline after restoration");
  }
}

async function waitForOperation(operationId) {
  const deadline = Date.now() + OPERATION_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const operation = await request(`/openharness-find/v1/operations/${operationId}`);
    if (TERMINAL_STATES.has(operation.state)) return operation;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, POLL_INTERVAL_MS));
  }
  throw new Error(`operation ${operationId} exceeded the audit timeout`);
}

async function install(plugin, revision) {
  const response = await fetch(new URL("/openharness-find/v1/operations", baseUrl), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: baseUrl.origin,
    },
    body: JSON.stringify({
      action: "install",
      plugin: plugin.name,
      version: plugin.version,
      catalogRevision: revision,
    }),
  });
  const queued = await response.json();
  if (!response.ok) {
    const now = new Date().toISOString();
    return {
      operationId: `rejected-${plugin.name}`,
      plugin: plugin.name,
      action: "install",
      state: "failed",
      startedAt: now,
      finishedAt: now,
      progress: null,
      result: null,
      error: queued.error ?? {
        code: "HOST_API_FAILED",
        message: `installation request failed with HTTP ${response.status}`,
      },
    };
  }
  return waitForOperation(queued.operationId);
}

const environment = await request("/openharness-find/v1/environment");
const catalog = await request("/openharness-find/v1/catalog?refresh=1");
if (environment.catalogRevision !== catalog.revision) {
  throw new Error("plugin catalog changed between environment and catalog requests");
}
const profileDirectory = join(dshHome, "profiles", environment.profile);
const baseline = await snapshot(profileDirectory);
const baselineDigest = snapshotDigest(baseline);
const results = [];

for (const [index, plugin] of catalog.plugins.slice(0, limit).entries()) {
  const attempts = [];
  let rollbackIntact = true;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const operation = await install(plugin, catalog.revision);
    attempts.push(operation);
    if (operation.state === "completed") break;
    const currentDigest = snapshotDigest(await snapshot(profileDirectory));
    if (currentDigest !== baselineDigest) {
      rollbackIntact = false;
      await resetProfile(profileDirectory, baseline, baselineDigest);
    }
  }
  if (attempts.at(-1).state === "completed") {
    await resetProfile(profileDirectory, baseline, baselineDigest);
  }
  const result = {
    index: index + 1,
    name: plugin.name,
    version: plugin.version,
    distribution: plugin.distribution,
    compatibility: plugin.compatibility,
    rollbackIntact,
    attempts,
  };
  results.push(result);
  if (outputPath) {
    await writeFile(outputPath, `${JSON.stringify({
      auditedAt: new Date().toISOString(),
      catalog: {
        revision: catalog.revision,
        generatedAt: catalog.generatedAt,
        totalPlugins: catalog.plugins.length,
      },
      environment,
      limit,
      results,
    }, null, 2)}\n`);
  }
  console.log(
    JSON.stringify({
      index: result.index,
      name: result.name,
      states: attempts.map((attempt) => attempt.state),
      errorCodes: attempts.map((attempt) => attempt.error?.code ?? null),
      rollbackIntact,
    }),
  );
}

const report = {
  auditedAt: new Date().toISOString(),
  catalog: {
    revision: catalog.revision,
    generatedAt: catalog.generatedAt,
    totalPlugins: catalog.plugins.length,
  },
  environment,
  limit,
  results,
};
if (outputPath) await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);
else console.log(JSON.stringify(report, null, 2));
