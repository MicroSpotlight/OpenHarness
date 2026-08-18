import { Service } from "@deepseek-ai/cordis";
import {
  MANAGED_RUNTIME_PROTOCOL_VERSION,
  MANAGED_RUNTIME_SERVICE_NAME,
  ManagedRuntimeExecutor,
  readManagedRuntimeEnvironment,
} from "./managed-runtime.js";

export class OpenHarnessPluginRuntimeService extends Service {
  constructor(ctx, configuration) {
    super(ctx, MANAGED_RUNTIME_SERVICE_NAME);
    this.kind = "managed-host";
    this.protocolVersion = MANAGED_RUNTIME_PROTOCOL_VERSION;
    this.executor = new ManagedRuntimeExecutor(configuration);
    this.currentProfile = this.executor.currentProfile;
    ctx.effect(() => () => this.executor.dispose(), "OpenHarness managed runtime");

    const shutdown = (signal) => {
      this.executor.dispose(true);
      process.removeListener("SIGTERM", onSigterm);
      process.removeListener("SIGINT", onSigint);
      process.kill(process.pid, signal);
    };
    const onSigterm = () => shutdown("SIGTERM");
    const onSigint = () => shutdown("SIGINT");
    const onExit = () => this.executor.dispose(true);
    process.once("SIGTERM", onSigterm);
    process.once("SIGINT", onSigint);
    process.once("exit", onExit);
    ctx.effect(() => () => {
      process.removeListener("SIGTERM", onSigterm);
      process.removeListener("SIGINT", onSigint);
      process.removeListener("exit", onExit);
    }, "OpenHarness managed runtime process cleanup");
  }

  probe() {
    return this.executor.probe();
  }

  run(args, options) {
    return this.executor.run(args, options);
  }

  async restart() {
    this.executor.restart();
  }
}

export function apply(ctx) {
  const configuration = readManagedRuntimeEnvironment();
  if (configuration === undefined) return;
  new OpenHarnessPluginRuntimeService(ctx, configuration);
}

export {
  MANAGED_RUNTIME_PROTOCOL_VERSION,
  MANAGED_RUNTIME_SERVICE_NAME,
  ManagedRuntimeExecutor,
  ManagedRuntimeError,
  readManagedRuntimeEnvironment,
} from "./managed-runtime.js";
