# ffprobe: why it is a dependency, and its licensing

## Why the server needs it

Confirming a teacher's uploaded audio (`POST /v1/teacher/recordings/:id/upload-sessions/:sessionId/confirm`)
shells out to `ffprobe` to read duration, codec, channels and bitrate before a
`recording_audio_assets` row is written. Without it, every confirmation fails
with a 503 and `publishRecording` then fails its "a confirmed audio recording is
required before publishing" guard — the teacher records, hits Submit, and lands
on the save-failed screen.

Before August 2026 `ffprobe` was an **undeclared** external dependency: no
`package.json` entry, no Dockerfile, no CI step, no note here. A host without it
looked like a transient outage rather than a misconfiguration. Declaring it is
what closed that gap.

## How the binary is resolved

`src/platform/storage/ffprobe-binary.ts` resolves it once at boot, inside
`createRuntimePlatformDependencies`:

1. `FFPROBE_PATH` wins **if the binary at that path can actually be launched**
   (probed with `spawnSync(path, ['-version'])`). Source: `configured`.
2. Otherwise the packaged `@ffprobe-installer/ffprobe` binary is used.
   Source: `bundled`.
3. Otherwise the resolution is `unavailable`.

Each outcome is logged at boot — `info` for `configured`, `warn` for `bundled`,
`error` for `unavailable`. The launch probe (rather than a bare "is the setting
present" check) is what makes an existing `FFPROBE_PATH=ffprobe` on a host with
no system ffprobe fall through to the packaged binary instead of failing.

## Licensing — read before shipping

| Package | License |
| --- | --- |
| `@ffprobe-installer/ffprobe@2.1.2` (the npm wrapper) | LGPL-2.1 |
| `@ffprobe-installer/win32-x64@5.1.0` (the binary it installs) | **GPL-3.0** |

The per-platform binary packages — `win32-x64`, `win32-ia32`, `linux-x64`,
`linux-arm64`, `linux-arm`, `linux-ia32`, `darwin-x64`, `darwin-arm64` — are
**GPL-3.0**, not LGPL. Installing this dependency puts a GPL-3.0 artifact in the
dependency tree.

Two facts make that acceptable here, and both must stay true:

- The binary is invoked as a **separate process** (`spawn`, never linked into
  the Node process). Separate-process invocation is the accepted pattern for
  using GPL tools from non-GPL code.
- It is a **server-side** dependency that is not distributed to end users. The
  Expo client never receives it.

If either changes — if ffprobe is ever linked in-process, bundled into a
distributed artifact, or shipped to a customer-controlled host — the GPL-3.0
obligations must be re-examined before release.

### Opting out of the GPL-3.0 binary

The fallback degrades cleanly to the previous behaviour plus the boot-time
`error` log, so removing it is safe as long as a system binary is present:

1. Install a system ffmpeg/ffprobe on every host that runs the API
   (`apt-get install ffmpeg`, `brew install ffmpeg`, `choco install ffmpeg`, or
   the platform equivalent).
2. Set `FFPROBE_PATH` to that binary's absolute path. The launch probe will
   prefer it automatically and log `configured` at boot.
3. `npm uninstall @ffprobe-installer/ffprobe`.

Step 2 must be verified on each host **before** step 3: with the packaged binary
gone and `FFPROBE_PATH` unlaunchable, `resolveFfprobeBinary` returns
`unavailable` and every recording confirmation returns 503 again.

Note that a system ffmpeg build is itself typically GPL-licensed; the point of
opting out is to keep GPL binaries out of the *npm dependency tree* and under
the host operator's control, not to obtain a permissively licensed ffprobe.
