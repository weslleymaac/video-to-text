import os
import json
import glob
import tempfile
import subprocess
import shutil
from http.server import BaseHTTPRequestHandler
import io

from openai import OpenAI

MAX_CHUNK_SIZE = 24 * 1024 * 1024  # 24MB (margem de segurança para o limite de 25MB)
MAX_DURATION_SECONDS = 2.5 * 60 * 60  # 2h30


def get_openai_client():
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        raise ValueError("OPENAI_API_KEY não configurada nas variáveis de ambiente.")
    return OpenAI(api_key=api_key)


def download_youtube_audio(url: str) -> tuple[str, str, str]:
    """Download audio from YouTube video. Returns (tmp_dir, title, duration)."""
    tmp_dir = tempfile.mkdtemp()

    # Get video info first to check duration
    info_cmd = [
        "yt-dlp",
        "--dump-json",
        "--no-download",
        url,
    ]
    info_result = subprocess.run(info_cmd, capture_output=True, text=True, timeout=30)
    title = ""
    duration = ""
    dur_secs = 0

    if info_result.returncode == 0:
        try:
            info = json.loads(info_result.stdout)
            title = info.get("title", "")
            dur_secs = info.get("duration", 0)
            if dur_secs:
                if dur_secs > MAX_DURATION_SECONDS:
                    shutil.rmtree(tmp_dir, ignore_errors=True)
                    raise ValueError(f"Vídeo muito longo ({dur_secs // 60}min). O limite é 2h30.")
                mins, secs = divmod(int(dur_secs), 60)
                hours, mins = divmod(mins, 60)
                if hours:
                    duration = f"{hours}h {mins:02d}m {secs:02d}s"
                else:
                    duration = f"{mins}m {secs:02d}s"
        except json.JSONDecodeError:
            pass

    # Download audio
    cmd = [
        "yt-dlp",
        "--extract-audio",
        "--audio-format", "mp3",
        "--audio-quality", "5",
        "--no-playlist",
        "--output", os.path.join(tmp_dir, "audio.%(ext)s"),
        url,
    ]

    subprocess.run(cmd, capture_output=True, text=True, check=True, timeout=600)

    audio_path = os.path.join(tmp_dir, "audio.mp3")
    return audio_path, title, duration


def split_audio(file_path: str, tmp_dir: str, chunk_minutes: int = 10) -> list[str]:
    """Split audio into chunks using ffmpeg. Returns list of chunk file paths."""
    file_size = os.path.getsize(file_path)

    # If file is small enough, no need to split
    if file_size <= MAX_CHUNK_SIZE:
        return [file_path]

    chunk_duration = chunk_minutes * 60  # seconds
    chunks_dir = os.path.join(tmp_dir, "chunks")
    os.makedirs(chunks_dir, exist_ok=True)

    cmd = [
        "ffmpeg",
        "-i", file_path,
        "-f", "segment",
        "-segment_time", str(chunk_duration),
        "-c", "copy",
        "-reset_timestamps", "1",
        os.path.join(chunks_dir, "chunk_%03d.mp3"),
    ]

    subprocess.run(cmd, capture_output=True, text=True, check=True, timeout=120)

    chunk_files = sorted(glob.glob(os.path.join(chunks_dir, "chunk_*.mp3")))

    if not chunk_files:
        raise ValueError("Erro ao dividir o áudio em partes.")

    return chunk_files


def transcribe_audio(file_path: str = None, file_bytes: bytes = None, filename: str = "audio.mp3") -> str:
    """Transcribe audio using OpenAI Whisper API. Handles large files by splitting."""
    client = get_openai_client()

    if file_path:
        file_size = os.path.getsize(file_path)
        tmp_dir = os.path.dirname(file_path)

        if file_size > MAX_CHUNK_SIZE:
            # Split and transcribe each chunk
            chunks = split_audio(file_path, tmp_dir)
            transcripts = []
            for chunk in chunks:
                with open(chunk, "rb") as f:
                    text = client.audio.transcriptions.create(
                        model="whisper-1",
                        file=f,
                        response_format="text",
                    )
                transcripts.append(text)
            return " ".join(transcripts)
        else:
            with open(file_path, "rb") as f:
                return client.audio.transcriptions.create(
                    model="whisper-1",
                    file=f,
                    response_format="text",
                )
    elif file_bytes:
        if len(file_bytes) > MAX_CHUNK_SIZE:
            # Save to temp file and split
            tmp_dir = tempfile.mkdtemp()
            tmp_path = os.path.join(tmp_dir, filename)
            with open(tmp_path, "wb") as f:
                f.write(file_bytes)
            try:
                chunks = split_audio(tmp_path, tmp_dir)
                transcripts = []
                for chunk in chunks:
                    with open(chunk, "rb") as f:
                        text = client.audio.transcriptions.create(
                            model="whisper-1",
                            file=f,
                            response_format="text",
                        )
                    transcripts.append(text)
                return " ".join(transcripts)
            finally:
                shutil.rmtree(tmp_dir, ignore_errors=True)
        else:
            audio_file = io.BytesIO(file_bytes)
            audio_file.name = filename
            return client.audio.transcriptions.create(
                model="whisper-1",
                file=audio_file,
                response_format="text",
            )
    else:
        raise ValueError("Nenhum arquivo fornecido.")


def parse_multipart(body: bytes, content_type: str) -> tuple[bytes, str]:
    """Parse multipart form data to extract file."""
    boundary = content_type.split("boundary=")[-1].encode()
    parts = body.split(b"--" + boundary)

    for part in parts:
        if b"filename=" in part:
            header_end = part.find(b"\r\n\r\n")
            headers = part[:header_end].decode("utf-8", errors="ignore")
            file_data = part[header_end + 4:]
            if file_data.endswith(b"\r\n"):
                file_data = file_data[:-2]

            filename = "upload.mp3"
            for line in headers.split("\r\n"):
                if "filename=" in line:
                    fname = line.split('filename="')[-1].split('"')[0]
                    if fname:
                        filename = fname
                    break

            return file_data, filename

    raise ValueError("Nenhum arquivo encontrado no upload.")


class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        try:
            content_type = self.headers.get("Content-Type", "")
            content_length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(content_length)

            if "application/json" in content_type:
                # YouTube URL mode
                data = json.loads(body)
                youtube_url = data.get("youtube_url", "").strip()

                if not youtube_url:
                    self._send_error(400, "URL do YouTube é obrigatória.")
                    return

                if "youtube.com" not in youtube_url and "youtu.be" not in youtube_url:
                    self._send_error(400, "URL inválida. Insira um link válido do YouTube.")
                    return

                file_path, title, duration = download_youtube_audio(youtube_url)

                try:
                    transcript_text = transcribe_audio(file_path=file_path)
                finally:
                    shutil.rmtree(os.path.dirname(file_path), ignore_errors=True)

                self._send_json(200, {
                    "transcript": transcript_text,
                    "title": title,
                    "duration": duration,
                })

            elif "multipart/form-data" in content_type:
                # File upload mode
                file_bytes, filename = parse_multipart(body, content_type)

                transcript_text = transcribe_audio(file_bytes=file_bytes, filename=filename)

                self._send_json(200, {
                    "transcript": transcript_text,
                    "title": filename,
                    "duration": "",
                })

            else:
                self._send_error(400, "Content-Type não suportado.")

        except subprocess.CalledProcessError as e:
            self._send_error(500, f"Erro ao baixar o vídeo: {e.stderr or 'Verifique se o link é válido.'}")
        except subprocess.TimeoutExpired:
            self._send_error(500, "Timeout ao processar o vídeo. Tente novamente.")
        except ValueError as e:
            self._send_error(400, str(e))
        except Exception as e:
            self._send_error(500, f"Erro interno: {str(e)}")

    def _send_json(self, status: int, data: dict):
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps(data, ensure_ascii=False).encode("utf-8"))

    def _send_error(self, status: int, message: str):
        self._send_json(status, {"error": message})
