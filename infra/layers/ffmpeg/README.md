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

Whisper.cpp assets are separate: a Linux binary (uploaded as `main`) and
the `ggml-base.en.bin` model, uploaded once to the WhisperAssets bucket
under `boom-busters/whisper/` after the first deploy.

Build the binary on Amazon Linux 2023 (the Node 20 runtime's base) with
OpenMP OFF — the Lambda runtime image ships no `libgomp.so.1`, so a
default build loads fine on a full AL2023 box and then dies inside
Lambda. `GGML_NATIVE=OFF` keeps the build machine's CPU flags out of it:

```sh
docker run --rm -v "$PWD/whisper-out:/out" amazonlinux:2023 bash -c '
  dnf install -y -q git gcc gcc-c++ cmake make tar gzip &&
  git clone --depth 1 --branch v1.7.4 https://github.com/ggerganov/whisper.cpp /w &&
  cmake -S /w -B /w/build -DBUILD_SHARED_LIBS=OFF -DGGML_NATIVE=OFF \
    -DGGML_OPENMP=OFF -DCMAKE_BUILD_TYPE=Release &&
  cmake --build /w/build -j4 --config Release &&
  cp /w/build/bin/whisper-cli /out/main'

# Verify against the real runtime image before uploading:
docker run --rm --entrypoint bash -v "$PWD/whisper-out:/c:ro" \
  public.ecr.aws/lambda/nodejs:20 -c 'cp /c/main /tmp/m && chmod +x /tmp/m && /tmp/m --help >/dev/null && echo OK'

# Model (~148 MB):
curl -sLO https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin

aws s3 cp whisper-out/main   s3://<WhisperAssets-bucket>/boom-busters/whisper/main
aws s3 cp ggml-base.en.bin   s3://<WhisperAssets-bucket>/boom-busters/whisper/ggml-base.en.bin
```
