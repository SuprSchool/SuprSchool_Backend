import { describe, expect, it, vi } from 'vitest';

import {
  bundledFfprobePath,
  canLaunchFfprobe,
  resolveFfprobeBinary,
} from '../src/platform/storage/ffprobe-binary.js';
import {
  NodeCommandRunner,
  RecordingMediaInspector,
} from '../src/platform/storage/recording-media-inspector.js';

describe('ffprobe binary resolution', () => {
  it('keeps an explicitly configured binary when it can be launched', () => {
    const canLaunch = vi.fn((path: string) => path === '/usr/local/bin/ffprobe');
    const bundledPath = vi.fn(() => '/packaged/ffprobe');

    expect(resolveFfprobeBinary('/usr/local/bin/ffprobe', { bundledPath, canLaunch }))
      .toEqual({ path: '/usr/local/bin/ffprobe', source: 'configured' });
    expect(bundledPath).not.toHaveBeenCalled();
  });

  it('falls back to the packaged binary when the configured path cannot be launched', () => {
    // Regression: a host with no ffprobe on PATH answered every recording audio
    // confirmation with `spawn ffprobe ENOENT` -> 503, so no recording could be
    // published. The configured default must not be the only candidate.
    const canLaunch = vi.fn((path: string) => path === '/packaged/ffprobe');

    expect(resolveFfprobeBinary('ffprobe', { bundledPath: () => '/packaged/ffprobe', canLaunch }))
      .toEqual({ path: '/packaged/ffprobe', source: 'bundled' });
    expect(canLaunch).toHaveBeenCalledWith('ffprobe');
  });

  it('reports the resolution as unavailable when neither candidate launches', () => {
    expect(resolveFfprobeBinary('ffprobe', { bundledPath: () => undefined, canLaunch: () => false }))
      .toEqual({ path: 'ffprobe', source: 'unavailable' });
    expect(resolveFfprobeBinary('ffprobe', { bundledPath: () => '/packaged/ffprobe', canLaunch: () => false }))
      .toEqual({ path: 'ffprobe', source: 'unavailable' });
  });

  it('ships a launchable packaged binary so a stock install can inspect recordings', () => {
    const packaged = bundledFfprobePath();

    expect(packaged, 'the per-platform @ffprobe-installer binary must be installed').toBeTypeOf('string');
    // Generous timeout on purpose: this is the one assertion that spawns the
    // real ~80 MB binary, and it runs while the rest of the suite saturates the
    // machine. The boot-time default (10s) timed out here under full-suite load
    // even though the binary launches in ~0.3s on its own, which made the gate
    // flaky. What is under test is "the packaged binary runs", not how fast.
    expect(canLaunchFfprobe(packaged ?? '', 120_000)).toBe(true);
  }, 130_000);

  it('does not treat a missing binary as launchable', () => {
    expect(canLaunchFfprobe('suprschool-ffprobe-that-does-not-exist')).toBe(false);
  });

  it('surfaces the launch failure as the cause when the resolved binary is missing', async () => {
    // The wrapper deliberately answers 503 so the idempotency claim is released
    // and the mutation stays retryable, but the cause must still name the spawn
    // failure — that is the only signal an operator can act on.
    const inspector = new RecordingMediaInspector({
      commandRunner: new NodeCommandRunner(),
      createSignedReadUrl: async () => 'https://storage.example.test/private/audio.m4a?token=opaque',
      ffprobePath: 'suprschool-ffprobe-that-does-not-exist',
    });

    const failure = await inspector
      .inspect({ bucket: 'recordings', objectPath: 'school/recording-audio/id/upload' })
      .then(() => undefined, (error: unknown) => error);

    expect(failure).toMatchObject({ retryable: true, status: 503 });
    expect((failure as { cause?: Error }).cause?.message).toContain('suprschool-ffprobe-that-does-not-exist');
  });
});
