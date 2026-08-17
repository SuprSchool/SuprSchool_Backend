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

/**
 * Launches the candidate once; `-version` exits 0 on every ffprobe build.
 *
 * A missing binary fails immediately with ENOENT, so the timeout only bites
 * when the binary exists but is slow to start — a cold, ~80 MB, virus-scanned
 * executable on a loaded host. Callers that probe under heavy concurrency
 * should raise it; the default is sized for a single boot-time probe.
 */
export function canLaunchFfprobe(
  path: string,
  timeoutMilliseconds: number = LAUNCH_PROBE_TIMEOUT_MILLISECONDS,
): boolean {
  const result = spawnSync(path, ['-version'], {
    shell: false,
    stdio: 'ignore',
    timeout: timeoutMilliseconds,
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

/** Answers "which binary do I launch right now?" for one inspection. */
export interface FfprobeBinaryResolver {
  resolve(): FfprobeResolution;
}

/**
 * Resolving once at boot and pinning the answer made a single unavailable
 * outcome permanent: a host that had not installed the packaged binary yet, or
 * whose probe timed out while the machine was loaded, then failed *every*
 * recording save for the life of the process with no way back but a restart.
 *
 * A launchable answer is still cached — the probe spawns an ~80 MB executable
 * and must not run per confirmation — but an unavailable one is retried, so the
 * pipeline recovers on its own as soon as a binary exists.
 */
export function createFfprobeBinaryResolver(
  configuredPath: string,
  options: ResolveFfprobeBinaryOptions = {},
): FfprobeBinaryResolver {
  let cached: FfprobeResolution | undefined;

  return {
    resolve(): FfprobeResolution {
      if (cached !== undefined && cached.source !== 'unavailable') return cached;
      cached = resolveFfprobeBinary(configuredPath, options);
      return cached;
    },
  };
}
