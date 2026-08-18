# FFmpeg layer

The media-utils Lambda expects a static `ffmpeg` binary at `/opt/bin/ffmpeg`,
which means this directory must contain `bin/ffmpeg` (Linux x86_64, static)
before `cdk deploy`. The binary is ~78 MB and is **not** committed; fetch it
at deploy time:

```sh
# From infra/:
curl -L https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz \
  | tar -xJ --strip-components=1 -C layers/ffmpeg/bin --wildcards '*/ffmpeg'
```

(John Van Sickle's static builds are GPL-licensed FFmpeg binaries, the
standard source for Lambda layers.)

Whisper.cpp assets are separate: a Linux `main` binary (build via
`docker run -v ...` per whisper.cpp's README, or on any Amazon Linux box)
and the `ggml-base.en.bin` model, uploaded once to the WhisperAssets bucket
under `boom-busters/whisper/` after the first deploy.
