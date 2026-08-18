import type { Context, Service } from "@deepseek-ai/cordis";
import type {
  ManagedCommandResult,
  ManagedRunOptions,
  ManagedRuntimeConfiguration,
} from "./managed-runtime.js";

export * from "./managed-runtime.js";

export class OpenHarnessPluginRuntimeService extends Service {
  readonly kind: "managed-host";
  readonly protocolVersion: 1;
  readonly currentProfile: Readonly<{ name: string; directory: string }>;
  constructor(ctx: Context, configuration: ManagedRuntimeConfiguration);
  probe(): Promise<{ ready: true } | { ready: false; reason: string }>;
  run(args: readonly string[], options: ManagedRunOptions): Promise<ManagedCommandResult>;
  restart(): Promise<void>;
}

export function apply(ctx: Context): void;
