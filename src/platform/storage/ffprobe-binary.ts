import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

/**
 * Recording audio confirmation cannot complete without ffprobe, and a host that
 * has no ffprobe on PATH fails every confirmation with a 503 that names nothing.
 * The binary is therefore resolved once at boot: an explicitly configured path
 * wins when it can actually be launched, and the packaged binary is the fallback
 * so a stock `npm install` yields a working recording pipeline.
 */
export type FfprobeSource = 'bundled' | 'configured' | 'unavailable';

export interface FfprobeResolution {
  /** The path handed to the media inspector. */
  path: string;
  /** `unavailable` means neither candidate could be launched. */
  source: FfprobeSource;
}

export interface ResolveFfprobeBinaryOptions {
  bundledPath?: () => string | undefined;
  canLaunch?: (path: string) => boolean;
}

const LAUNCH_PROBE_TIMEOUT_MILLISECONDS = 10_000;

/** Launches the candidate once; `-version` exits 0 on every ffprobe build. */
export function canLaunchFfprobe(path: string): boolean {
  const result = spawnSync(path, ['-version'], {
    shell: false,
    stdio: 'ignore',
    timeout: LAUNCH_PROBE_TIMEOUT_MILLISECONDS,
  });
  return result.error === undefined && result.status === 0;
}

export function bundledFfprobePath(): string | undefined {
  try {
    const require = createRequire(import.meta.url);
    const installed = require('@ffprobe-installer/ffprobe') as { path?: unknown };
    return typeof installed.path === 'string' && installed.path.length > 0
      ? installed.path
      : undefined;
  } catch {
    // The per-platform binary is an optional dependency; absence is not fatal
    // here because the configured path may still be launchable.
    return undefined;
  }
}

export function resolveFfprobeBinary(
  configuredPath: string,
  options: ResolveFfprobeBinaryOptions = {},
): FfprobeResolution {
  const canLaunch = options.canLaunch ?? canLaunchFfprobe;
  const bundled = options.bundledPath ?? bundledFfprobePath;

  if (canLaunch(configuredPath)) {
    return { path: configuredPath, source: 'configured' };
  }

  const bundledPath = bundled();
  if (bundledPath !== undefined && canLaunch(bundledPath)) {
    return { path: bundledPath, source: 'bundled' };
  }

  return { path: configuredPath, source: 'unavailable' };
}
