import { spawn } from 'node:child_process';
import { AppError } from '../../lib/errors.js';

export const FFPROBE_TIMEOUT_MILLISECONDS = 30_000;
export const FFPROBE_MAX_CONCURRENT_PROCESSES = 2;
const SIGNED_READ_URL_TTL_SECONDS = 60;

export interface CommandResult {
  exitCode: number;
  stderr: string;
  stdout: string;
}

export interface CommandRunner {
  run(
    command: string,
    args: readonly string[],
    options: { timeoutMilliseconds: number },
  ): Promise<CommandResult>;
}

export class CommandTimeoutError extends Error {
  public constructor(timeoutMilliseconds: number) {
    super(`Command exceeded ${timeoutMilliseconds} ms`);
    this.name = 'CommandTimeoutError';
  }
}

export class NodeCommandRunner implements CommandRunner {
  public run(
    command: string,
    args: readonly string[],
    options: { timeoutMilliseconds: number },
  ): Promise<CommandResult> {
    return new Promise((resolve, reject) => {
      const child = spawn(command, args, {
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      let timedOut = false;
      const timeout = setTimeout(() => {
        timedOut = true;
        child.kill('SIGKILL');
      }, options.timeoutMilliseconds);

      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk: string) => { stdout += chunk; });
      child.stderr.setEncoding('utf8');
      child.stderr.on('data', (chunk: string) => { stderr += chunk; });
      child.once('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });
      child.once('close', (exitCode) => {
        clearTimeout(timeout);
        if (timedOut) {
          reject(new CommandTimeoutError(options.timeoutMilliseconds));
          return;
        }
        resolve({ exitCode: exitCode ?? -1, stderr, stdout });
      });
    });
  }
}

export interface RecordingMediaInspection {
  bitrateBps: number;
  channels: number;
  codec: string;
  contentType: string;
  durationMs: number;
  fileExtension: string;
}

export type SignedReadUrlCreator = (
  bucket: string,
  objectPath: string,
  expiresInSeconds: number,
) => Promise<string>;

export interface RecordingMediaInspectorOptions {
  commandRunner: CommandRunner;
  createSignedReadUrl: SignedReadUrlCreator;
  ffprobePath?: string;
  maxConcurrentProcesses?: number;
  timeoutMilliseconds?: number;
}

export class RecordingMediaInspectionDependencyError extends AppError {
  public readonly retryable = true;

  public constructor(cause?: unknown) {
    super('INTERNAL_ERROR', 503, 'Recording media inspection is temporarily unavailable');
    this.name = 'RecordingMediaInspectionDependencyError';
    if (cause !== undefined) this.cause = cause;
  }
}

class ConcurrencyGate {
  private active = 0;
  private readonly waiting: Array<() => void> = [];

  public constructor(private readonly maximum: number) {}

  public async run<T>(action: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await action();
    } finally {
      this.release();
    }
  }

  private acquire(): Promise<void> {
    if (this.active < this.maximum) {
      this.active += 1;
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.waiting.push(() => {
        this.active += 1;
        resolve();
      });
    });
  }

  private release(): void {
    this.active -= 1;
    this.waiting.shift()?.();
  }
}

interface FfprobeStream {
  bit_rate?: unknown;
  channels?: unknown;
  codec_name?: unknown;
  profile?: unknown;
}

interface FfprobeFormat {
  bit_rate?: unknown;
  duration?: unknown;
  format_name?: unknown;
}

interface FfprobeOutput {
  format?: FfprobeFormat;
  streams?: unknown;
}

export class RecordingMediaInspector {
  private readonly ffprobePath: string;
  private readonly gate: ConcurrencyGate;
  private readonly timeoutMilliseconds: number;

  public constructor(private readonly options: RecordingMediaInspectorOptions) {
    this.ffprobePath = options.ffprobePath ?? 'ffprobe';
    this.timeoutMilliseconds = options.timeoutMilliseconds ?? FFPROBE_TIMEOUT_MILLISECONDS;
    const concurrency = options.maxConcurrentProcesses ?? FFPROBE_MAX_CONCURRENT_PROCESSES;
    if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > FFPROBE_MAX_CONCURRENT_PROCESSES) {
      throw new RangeError(`ffprobe concurrency must be between 1 and ${FFPROBE_MAX_CONCURRENT_PROCESSES}`);
    }
    this.gate = new ConcurrencyGate(concurrency);
  }

  public inspect(input: { bucket: string; objectPath: string }): Promise<RecordingMediaInspection> {
    return this.gate.run(async () => {
      try {
        const signedUrl = await this.options.createSignedReadUrl(
          input.bucket,
          input.objectPath,
          SIGNED_READ_URL_TTL_SECONDS,
        );
        const result = await this.options.commandRunner.run(
          this.ffprobePath,
          [
            '-v', 'error',
            '-show_entries', 'format=duration,bit_rate,format_name:stream=codec_name,profile,channels,bit_rate',
            '-of', 'json',
            signedUrl,
          ],
          { timeoutMilliseconds: this.timeoutMilliseconds },
        );
        if (result.exitCode !== 0) {
          throw new Error(`ffprobe exited with status ${result.exitCode}`);
        }
        return parseFfprobeOutput(result.stdout);
      } catch (error) {
        if (error instanceof RecordingMediaInspectionDependencyError) throw error;
        throw new RecordingMediaInspectionDependencyError(error);
      }
    });
  }
}

function parseFfprobeOutput(stdout: string): RecordingMediaInspection {
  let output: FfprobeOutput;
  try {
    output = JSON.parse(stdout) as FfprobeOutput;
  } catch (error) {
    throw new RecordingMediaInspectionDependencyError(error);
  }
  if (!Array.isArray(output.streams) || output.format === undefined) {
    throw new RecordingMediaInspectionDependencyError();
  }
  const stream = output.streams.find(isFfprobeStream);
  if (stream === undefined) throw new RecordingMediaInspectionDependencyError();

  const durationSeconds = finitePositiveNumber(output.format.duration);
  const channels = positiveSafeInteger(stream.channels);
  const bitrateBps = positiveSafeInteger(stream.bit_rate) ?? positiveSafeInteger(output.format.bit_rate);
  const formatNames = typeof output.format.format_name === 'string'
    ? output.format.format_name.split(',').map((value) => value.trim().toLowerCase())
    : [];
  if (durationSeconds === undefined || channels === undefined || bitrateBps === undefined || formatNames.length === 0) {
    throw new RecordingMediaInspectionDependencyError();
  }
  const durationMs = Math.round(durationSeconds * 1_000);
  if (!Number.isSafeInteger(durationMs) || durationMs <= 0) {
    throw new RecordingMediaInspectionDependencyError();
  }

  const codecName = stream.codec_name;
  if (typeof codecName !== 'string' || codecName.length === 0) {
    throw new RecordingMediaInspectionDependencyError();
  }
  const normalizedCodecName = codecName.toLowerCase();
  const profile = typeof stream.profile === 'string' ? stream.profile.toLowerCase() : '';
  const codec = normalizedCodecName === 'aac' && (profile === 'lc' || profile === 'aac lc')
    ? 'aac-lc'
    : normalizedCodecName;
  const hasM4a = formatNames.includes('m4a');
  const hasMp4Container = hasM4a || formatNames.includes('mp4') || formatNames.includes('mov');
  if (!hasMp4Container) {
    throw new RecordingMediaInspectionDependencyError();
  }

  return {
    bitrateBps,
    channels,
    codec,
    contentType: 'audio/mp4',
    durationMs,
    fileExtension: hasM4a ? '.m4a' : '.mp4',
  };
}

function isFfprobeStream(value: unknown): value is FfprobeStream {
  return typeof value === 'object' && value !== null;
}

function finitePositiveNumber(value: unknown): number | undefined {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function positiveSafeInteger(value: unknown): number | undefined {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}
