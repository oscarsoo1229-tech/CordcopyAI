#!/usr/bin/env python3
"""ChordLens local demo server. Optional YouTube audio endpoint requires yt-dlp and FFmpeg.
Use only with audio you are authorized to download, and comply with YouTube's terms.
"""
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
import json, os, re, subprocess, tempfile, shutil, urllib.parse, logging, threading, time

ROOT = Path(__file__).resolve().parent.parent
MAX_BYTES = 80 * 1024 * 1024
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("chordlens.youtube")
_youtube_lock = threading.Lock()
_youtube_blocked_until = 0.0
YOUTUBE_HOSTS = {"youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com", "youtu.be", "www.youtu.be"}

class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self):
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "strict-origin-when-cross-origin")
        origin = self.headers.get("Origin", "")
        allowed = os.environ.get("CHORDLENS_ALLOWED_ORIGIN", "")
        if origin and (allowed == "*" or origin == allowed):
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")
            self.send_header("Vary", "Origin")
        super().end_headers()

    def do_OPTIONS(self):
        if self.path != "/api/youtube-audio":
            self.send_error(404)
            return
        origin = self.headers.get("Origin", "")
        allowed = os.environ.get("CHORDLENS_ALLOWED_ORIGIN", "")
        if not origin or not (allowed == "*" or origin == allowed):
            self._json_error(403, "이 웹사이트의 요청은 허용되지 않았습니다. CHORDLENS_ALLOWED_ORIGIN 설정을 확인하세요.")
            return
        self.send_response(204)
        self.end_headers()

    def do_POST(self):
        if self.path != "/api/youtube-audio":
            self.send_error(404); return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length <= 0 or length > 16384:
                self._json_error(400, "요청 크기가 올바르지 않습니다."); return
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
            raw = str(payload.get("url", ""))
            parsed = urllib.parse.urlparse(raw)
            host = (parsed.hostname or "").lower()
            if parsed.scheme != "https" or host not in YOUTUBE_HOSTS:
                self._json_error(400, "유효한 HTTPS YouTube URL만 허용됩니다."); return
            if not shutil.which("yt-dlp") or not shutil.which("ffmpeg"):
                self._json_error(503, "서버에 yt-dlp와 FFmpeg를 설치해야 합니다."); return
            global _youtube_blocked_until
            if not _youtube_lock.acquire(blocking=False):
                self._json_error(429, "다른 YouTube 분석이 진행 중입니다. 잠시 후 다시 시도해 주세요.")
                return
            try:
                if time.monotonic() < _youtube_blocked_until:
                    self._json_error(429, "YouTube가 서버의 요청을 제한했습니다. 잠시 후 다시 시도하거나 음원 파일을 업로드해 주세요.")
                    return
                self._download_youtube(raw)
            finally:
                _youtube_lock.release()
        except subprocess.TimeoutExpired:
            logger.warning("YouTube extraction timed out")
            self._json_error(504, "음원 요청 시간이 초과되었습니다.")
        except Exception:
            logger.exception("YouTube extraction unexpected error")
            self._json_error(500, "서버 오류가 발생했습니다. Render 로그를 확인해 주세요.")

    def _download_youtube(self, raw):
            global _youtube_blocked_until
            with tempfile.TemporaryDirectory(prefix="chordlens-") as tmp:
                output = str(Path(tmp) / "audio.%(ext)s")
                cmd = [
    "yt-dlp",
    "--no-playlist",
    "--no-progress",
    "--retries", "1",
    "--fragment-retries", "1",
    "--extractor-retries", "1",
    "--socket-timeout", "20",
    "--max-filesize", "80M",
    "--js-runtimes", "deno",
    "--remote-components", "ejs:github",
    "-f", "bestaudio/best",
    "-x",
    "--audio-format", "mp3",
    "--audio-quality", "5",
    "-o", output,
    raw
]
                proc = subprocess.run(cmd, capture_output=True, text=True, timeout=180, check=False)
                files = list(Path(tmp).glob("audio.*"))
                files = [f for f in files if f.suffix.lower() in {".mp3", ".m4a", ".opus", ".wav", ".webm"}]
                if proc.returncode != 0 or not files:
                    msg = (proc.stderr or proc.stdout or "음원 가져오기에 실패했습니다.")[-1200:]
                    is_limited = bool(re.search(r"HTTP Error 429|Too Many Requests|not a bot|Sign in to confirm", msg, re.I))
                    logger.warning("YouTube extraction failed: category=%s returncode=%s detail=%s", "rate_limited" if is_limited else "extractor_error", proc.returncode, msg.replace(raw, "[youtube-url]"))
                    if is_limited:
                        _youtube_blocked_until = time.monotonic() + 900
                        self._json_error(429, "YouTube가 Render 서버의 요청을 제한했습니다(429/봇 확인). 15분 동안 재시도를 제한합니다. 서버 IP 제한은 코드만으로 해결되지 않을 수 있습니다. 음원 파일 업로드를 이용해 주세요.")
                    else:
                        self._json_error(422, "YouTube 음원 추출에 실패했습니다. Render 로그의 extractor_error 항목을 확인해 주세요.")
                    return
                path = files[0]
                size = path.stat().st_size
                if size > MAX_BYTES:
                    self._json_error(413, "음원이 80MB 제한을 초과합니다."); return
                data = path.read_bytes()
            self.send_response(200)
            self.send_header("Content-Type", "audio/mpeg")
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers(); self.wfile.write(data)

    def _json_error(self, status, message):
        body = json.dumps({"error": message}, ensure_ascii=False).encode("utf-8")
        self.send_response(status); self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body))); self.end_headers(); self.wfile.write(body)

if __name__ == "__main__":
    host = os.environ.get("CHORDLENS_HOST", "0.0.0.0")
    port = int(os.environ.get("PORT", "8000"))
    print(f"ChordLens is running: http://{host}:{port}")
    print("YouTube analysis requires yt-dlp and FFmpeg. Use authorized audio only.")
    ThreadingHTTPServer((host, port), Handler).serve_forever()
