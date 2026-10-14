#!/usr/bin/env bash
# Installs a Mac-wide, OpenAI-compatible speech-to-text endpoint:
#   whisper.cpp whisper-server (Metal) on http://127.0.0.1:8178/v1/audio/transcriptions, run by launchd.
# Reusable from any project:  curl -F file=@a.wav -F model=whisper-1 127.0.0.1:8178/v1/audio/transcriptions
#
# Usage: scripts/setup-whisper.sh [model]     model: large-v3-turbo-q5_0 (default) | small.en | base.en
#        scripts/setup-whisper.sh --uninstall
set -euo pipefail

MODEL="${1:-large-v3-turbo-q5_0}"
PORT="${WHISPER_PORT:-8178}"
DIR="$HOME/.local/share/whisper"
LABEL="com.local.whisper-server"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"

if [[ "${1:-}" == "--uninstall" ]]; then
  launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
  rm -f "$PLIST"
  echo "Removed launchd service (models left in $DIR)."
  exit 0
fi

BIN="$(command -v whisper-server || true)"
if [[ -z "$BIN" ]]; then
  echo "whisper-server not found. Run: brew install whisper-cpp" >&2
  exit 1
fi

mkdir -p "$DIR" "$HOME/Library/LaunchAgents"
MODEL_FILE="$DIR/ggml-$MODEL.bin"
if [[ ! -f "$MODEL_FILE" ]]; then
  echo "Downloading ggml-$MODEL.bin ..."
  curl -fL --progress-bar -o "$MODEL_FILE.part" "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-$MODEL.bin"
  mv "$MODEL_FILE.part" "$MODEL_FILE"
fi

# Optional Core ML encoder (runs the encoder on the Neural Engine). whisper.cpp picks it up automatically
# when it sits next to the model and the build has Core ML support; harmless otherwise.
BASE="${MODEL%-q5_0}"; BASE="${BASE%-q8_0}"
ENC="$DIR/ggml-$BASE-encoder.mlmodelc"
if [[ ! -d "$ENC" ]]; then
  if curl -fsIL "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-$BASE-encoder.mlmodelc.zip" >/dev/null; then
    echo "Downloading Core ML encoder ..."
    curl -fL --progress-bar -o "$ENC.zip" "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-$BASE-encoder.mlmodelc.zip"
    (cd "$DIR" && unzip -q -o "$(basename "$ENC").zip" && rm -f "$(basename "$ENC").zip")
  fi
fi

cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$BIN</string>
    <string>--model</string><string>$MODEL_FILE</string>
    <string>--host</string><string>127.0.0.1</string>
    <string>--port</string><string>$PORT</string>
    <string>--inference-path</string><string>/v1/audio/transcriptions</string>
    <string>--language</string><string>auto</string>
    <string>--threads</string><string>6</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$DIR/whisper-server.log</string>
  <key>StandardErrorPath</key><string>$DIR/whisper-server.log</string>
</dict>
</plist>
PLIST

launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "whisper-server starting on http://127.0.0.1:$PORT (model $MODEL). Log: $DIR/whisper-server.log"
for _ in {1..30}; do
  curl -fs "http://127.0.0.1:$PORT/" >/dev/null 2>&1 && { echo "Ready."; exit 0; }
  sleep 1
done
echo "Not answering yet; check the log." >&2
