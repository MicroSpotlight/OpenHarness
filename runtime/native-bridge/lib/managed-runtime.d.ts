export const MANAGED_RUNTIME_PROTOCOL_VERSION: 1;
export const MANAGED_RUNTIME_SERVICE_NAME: "openharnessPluginRuntime";
export const MANAGED_RESTART_EXIT_CODE: 75;

export type ManagedRuntimeErrorCode =
  | "INVALID_OPERATION"
  | "OPERATION_BUSY"
  | "OPERATION_CANCELLED"
  | "OPERATION_TIMEOUT"
  | "OUTPUT_LIMIT_EXCEEDED"
  | "RUNTIME_NOT_READY";

export class ManagedRuntimeError extends Error {
  readonly code: ManagedRuntimeErrorCode;
  constructor(code: ManagedRuntimeErrorCode, message: string);
}

export interface ManagedRuntimeConfiguration {
  readonly protocolVersion: 1;
  readonly profileName: string;
  readonly profileDirectory: string;
  readonly dshHome: string;
  readonly runtimeRoot: string;
  readonly nodePath: string;
  readonly dshEntry: string;
  readonly packageManagerBinDirectory: string;
  readonly packageManagerLauncher: string;
  readonly restartExitCode: 75;
}

export type ManagedInstallProgressPhase = "resolving" | "downloading" | "linking";

export interface ManagedInstallProgressEvent {
  readonly phase: ManagedInstallProgressPhase;
  readonly completed?: number;
  readonly total?: number;
  readonly currentPackage?: string;
}

export interface ManagedRunOptions {
  readonly signal: AbortSignal;
  readonly onProgress: (event: ManagedInstallProgressEvent) => void;
}

export interface ManagedCommandResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

export class ManagedRuntimeExecutor {
  constructor(configuration: ManagedRuntimeConfiguration);
  readonly currentProfile: Readonly<{ name: string; directory: string }>;
  probe(): Promise<{ ready: true } | { ready: false; reason: string }>;
  run(args: readonly string[], options: ManagedRunOptions): Promise<ManagedCommandResult>;
  restart(): void;
  dispose(force?: boolean): void;
}

export function readManagedRuntimeEnvironment(
  environment?: NodeJS.ProcessEnv,
  platform?: NodeJS.Platform,
): ManagedRuntimeConfiguration | undefined;
