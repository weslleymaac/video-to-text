"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import {
  Youtube,
  Upload,
  FileAudio,
  Sparkles,
  Copy,
  Check,
  Download,
  Loader2,
  X,
  Wand2,
  Volume2,
  Globe,
  Clock,
  AlertCircle,
  Lock,
  LogOut,
} from "lucide-react";

const ACCESS_CODE = "676975";
const MAX_UPLOAD_SIZE = 100 * 1024 * 1024; // 100MB
const CHUNK_SIZE = 4 * 1024 * 1024; // 4MB por chunk (limite Vercel ~4.5MB)

type TabType = "youtube" | "upload";
type Status = "idle" | "loading" | "success" | "error";

async function compressAudioWithFFmpeg(
  file: File,
  onProgress: (msg: string) => void
): Promise<Blob[]> {
  onProgress("Carregando processador de áudio...");

  const { FFmpeg } = await import("@ffmpeg/ffmpeg");
  const { fetchFile, toBlobURL } = await import("@ffmpeg/util");

  const ffmpeg = new FFmpeg();

  const baseURL = "https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm";
  await ffmpeg.load({
    coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, "text/javascript"),
    wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, "application/wasm"),
  });

  onProgress("Extraindo e comprimindo áudio...");

  await ffmpeg.writeFile("input", await fetchFile(file));

  // Extrair áudio, comprimir para speech (mono, 16kHz, 48kbps)
  await ffmpeg.exec([
    "-i", "input",
    "-vn",           // sem vídeo
    "-ac", "1",      // mono
    "-ar", "16000",  // 16kHz (o que o Whisper usa internamente)
    "-b:a", "48k",   // 48kbps
    "-f", "mp3",
    "output.mp3",
  ]);

  const outputData = (await ffmpeg.readFile("output.mp3")) as Uint8Array;
  const totalSize = outputData.byteLength;

  // Se cabe num único request, retorna direto
  if (totalSize <= CHUNK_SIZE) {
    onProgress("Áudio pronto para transcrição...");
    return [new Blob([new Uint8Array(outputData)], { type: "audio/mpeg" })];
  }

  // Senão, divide em chunks com FFmpeg (por tempo)
  onProgress("Dividindo áudio em partes...");

  // Calcular duração aproximada do áudio
  // 48kbps = 6000 bytes/s → chunk de 4MB ≈ 700s ≈ 11min
  const chunkDurationSecs = Math.floor((CHUNK_SIZE / (48000 / 8)) * 0.9); // margem de 10%

  await ffmpeg.exec([
    "-i", "output.mp3",
    "-f", "segment",
    "-segment_time", String(chunkDurationSecs),
    "-c", "copy",
    "-reset_timestamps", "1",
    "chunk_%03d.mp3",
  ]);

  // Ler todos os chunks
  const chunks: Blob[] = [];
  for (let i = 0; i < 100; i++) {
    const name = `chunk_${String(i).padStart(3, "0")}.mp3`;
    try {
      const data = await ffmpeg.readFile(name);
      chunks.push(new Blob([new Uint8Array(data as Uint8Array)], { type: "audio/mpeg" }));
    } catch {
      break;
    }
  }

  onProgress(`Áudio dividido em ${chunks.length} partes...`);
  return chunks;
}

async function sendChunkForTranscription(chunk: Blob, index: number): Promise<string> {
  const formData = new FormData();
  formData.append("file", chunk, `chunk_${index}.mp3`);

  const response = await fetch("/api/transcribe", {
    method: "POST",
    body: formData,
  });

  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("Erro no servidor ao transcrever parte do áudio.");
  }

  if (!response.ok) {
    throw new Error(data.error || "Erro ao transcrever parte do áudio.");
  }

  return data.transcript;
}

export default function Home() {
  const [authenticated, setAuthenticated] = useState(false);
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState(false);
  const [activeTab, setActiveTab] = useState<TabType>("youtube");
  const [youtubeUrl, setYoutubeUrl] = useState("");
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [transcript, setTranscript] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [progress, setProgress] = useState(0);
  const [progressMsg, setProgressMsg] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [copied, setCopied] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [videoTitle, setVideoTitle] = useState("");
  const [duration, setDuration] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (localStorage.getItem("vt_auth") === "true") {
      setAuthenticated(true);
    }
  }, []);

  const handleLogin = () => {
    if (password === ACCESS_CODE) {
      localStorage.setItem("vt_auth", "true");
      setAuthenticated(true);
      setLoginError(false);
    } else {
      setLoginError(true);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem("vt_auth");
    setAuthenticated(false);
    setPassword("");
  };

  const handleTranscribe = async () => {
    setStatus("loading");
    setTranscript("");
    setErrorMsg("");
    setProgress(0);
    setProgressMsg("");
    setVideoTitle("");
    setDuration("");

    try {
      if (activeTab === "youtube") {
        // YouTube mode
        if (!youtubeUrl.trim()) {
          throw new Error("Por favor, insira o link do YouTube.");
        }

        setProgressMsg("Buscando transcrição do YouTube...");
        setProgress(30);

        const response = await fetch("/api/transcribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ youtube_url: youtubeUrl.trim() }),
        });

        const text = await response.text();
        let data;
        try {
          data = JSON.parse(text);
        } catch {
          throw new Error("Erro no servidor. Tente novamente.");
        }

        if (!response.ok) {
          throw new Error(data.error || "Erro ao transcrever o vídeo.");
        }

        setProgress(100);
        setTranscript(data.transcript);
        if (data.title) setVideoTitle(data.title);
        if (data.duration) setDuration(data.duration);

      } else {
        // Upload mode - processa no browser com FFmpeg
        if (!uploadedFile) {
          throw new Error("Por favor, selecione um arquivo de vídeo/áudio.");
        }

        if (uploadedFile.size > MAX_UPLOAD_SIZE) {
          throw new Error(
            `Arquivo muito grande (${(uploadedFile.size / (1024 * 1024)).toFixed(0)}MB). O limite é 100MB.`
          );
        }

        setProgress(5);

        // Comprimir áudio no browser
        const chunks = await compressAudioWithFFmpeg(uploadedFile, (msg) => {
          setProgressMsg(msg);
          setProgress((prev) => Math.min(prev + 10, 40));
        });

        setProgress(40);

        // Enviar cada chunk para transcrição
        const transcripts: string[] = [];
        for (let i = 0; i < chunks.length; i++) {
          setProgressMsg(
            chunks.length > 1
              ? `Transcrevendo parte ${i + 1} de ${chunks.length}...`
              : "Transcrevendo com IA..."
          );

          const chunkTranscript = await sendChunkForTranscription(chunks[i], i);
          transcripts.push(chunkTranscript);

          setProgress(40 + Math.round(((i + 1) / chunks.length) * 55));
        }

        setProgress(100);
        setTranscript(transcripts.join(" "));
        setVideoTitle(uploadedFile.name);
      }

      setStatus("success");
    } catch (err: any) {
      if (err.name === "AbortError") {
        setErrorMsg("Timeout: o processamento demorou demais.");
      } else {
        setErrorMsg(err.message || "Erro inesperado.");
      }
      setStatus("error");
    }
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(transcript);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    const blob = new Blob([transcript], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `transcricao-${Date.now()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) setUploadedFile(file);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    setDragOver(false);
  }, []);

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  if (!authenticated) {
    return (
      <div className="min-h-screen dot-pattern relative flex items-center justify-center">
        <div className="fixed inset-0 overflow-hidden pointer-events-none">
          <div className="absolute -top-40 -left-40 w-96 h-96 bg-purple-300/20 rounded-full blur-[120px] animate-pulse-slow" />
          <div className="absolute top-1/3 -right-40 w-80 h-80 bg-violet-300/20 rounded-full blur-[100px] animate-pulse-slow" />
          <div className="absolute -bottom-40 left-1/3 w-72 h-72 bg-indigo-300/15 rounded-full blur-[100px] animate-pulse-slow" />
        </div>

        <div className="relative z-10 w-full max-w-sm mx-auto px-4">
          <div className="glass-strong rounded-2xl p-8 glow-purple-sm text-center">
            <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-purple-100 mb-5">
              <Lock className="w-7 h-7 text-purple-600" />
            </div>
            <h1 className="text-2xl font-bold text-gray-800 mb-2">Acesso Restrito</h1>
            <p className="text-sm text-[var(--text-secondary)] mb-6">
              Digite a senha para acessar o sistema.
            </p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleLogin();
              }}
            >
              <input
                type="password"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  setLoginError(false);
                }}
                placeholder="Senha de acesso"
                className="input-field w-full px-4 py-3.5 rounded-xl text-sm text-center tracking-widest"
                autoFocus
              />
              {loginError && (
                <p className="text-xs text-red-500 mt-2">Senha incorreta.</p>
              )}
              <button
                type="submit"
                className="btn-primary w-full mt-4 py-3.5 rounded-xl text-sm font-semibold text-white flex items-center justify-center gap-2"
              >
                <Lock className="w-4 h-4" />
                Entrar
              </button>
            </form>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen dot-pattern relative">
      {/* Background gradient orbs */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -left-40 w-96 h-96 bg-purple-300/20 rounded-full blur-[120px] animate-pulse-slow" />
        <div className="absolute top-1/3 -right-40 w-80 h-80 bg-violet-300/20 rounded-full blur-[100px] animate-pulse-slow" />
        <div className="absolute -bottom-40 left-1/3 w-72 h-72 bg-indigo-300/15 rounded-full blur-[100px] animate-pulse-slow" />
      </div>

      <div className="relative z-10 max-w-3xl mx-auto px-4 sm:px-6 py-10 sm:py-16">
        {/* Logout button */}
        <button
          onClick={handleLogout}
          className="absolute top-4 right-4 sm:top-6 sm:right-6 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-[var(--text-secondary)] hover:text-gray-800 hover:bg-gray-100 border border-[var(--border-color)] transition-all z-20"
        >
          <LogOut className="w-3.5 h-3.5" />
          Sair
        </button>

        {/* Header */}
        <header className="text-center mb-10 sm:mb-14">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full glass-strong text-xs text-purple-600 mb-6 animate-float">
            <Sparkles className="w-3.5 h-3.5" />
            Powered by OpenAI Whisper
          </div>

          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight mb-4">
            <span className="gradient-text">Video</span>{" "}
            <span className="text-gray-800">Transcriber</span>
          </h1>

          <p className="text-base sm:text-lg text-[var(--text-secondary)] max-w-lg mx-auto leading-relaxed">
            Transcreva vídeos do YouTube ou arquivos de áudio/vídeo com
            inteligência artificial em segundos.
          </p>
        </header>

        {/* Main Card */}
        <div className="glass-strong rounded-2xl p-6 sm:p-8 glow-purple-sm">
          {/* Tabs */}
          <div className="flex gap-2 mb-8">
            <button
              onClick={() => setActiveTab("youtube")}
              className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-medium border transition-all ${
                activeTab === "youtube" ? "tab-active" : "tab-inactive"
              }`}
            >
              <Youtube className="w-4 h-4" />
              YouTube
            </button>
            <button
              onClick={() => setActiveTab("upload")}
              className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-medium border transition-all ${
                activeTab === "upload" ? "tab-active" : "tab-inactive"
              }`}
            >
              <Upload className="w-4 h-4" />
              Upload
            </button>
          </div>

          {/* YouTube Input */}
          {activeTab === "youtube" && (
            <div className="space-y-4">
              <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1.5">
                Link do vídeo do YouTube
              </label>
              <div className="relative">
                <Globe className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-[var(--text-secondary)]" />
                <input
                  type="url"
                  value={youtubeUrl}
                  onChange={(e) => setYoutubeUrl(e.target.value)}
                  placeholder="https://www.youtube.com/watch?v=..."
                  className="input-field w-full pl-12 pr-4 py-3.5 rounded-xl text-sm"
                  disabled={status === "loading"}
                />
              </div>
            </div>
          )}

          {/* Upload Input */}
          {activeTab === "upload" && (
            <div className="space-y-4">
              <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1.5">
                Arquivo de vídeo ou áudio (até 100MB)
              </label>
              <div
                onDrop={handleDrop}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onClick={() => fileInputRef.current?.click()}
                className={`drop-zone rounded-xl p-8 sm:p-10 text-center cursor-pointer ${
                  dragOver ? "drag-over" : ""
                }`}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="video/*,audio/*,.mp3,.mp4,.wav,.m4a,.webm,.ogg,.avi,.mov,.mkv"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) setUploadedFile(file);
                  }}
                  className="hidden"
                  disabled={status === "loading"}
                />

                {uploadedFile ? (
                  <div className="flex items-center justify-center gap-3">
                    <FileAudio className="w-8 h-8 text-purple-600" />
                    <div className="text-left">
                      <p className="text-sm font-medium text-gray-800 truncate max-w-xs">
                        {uploadedFile.name}
                      </p>
                      <p className="text-xs text-[var(--text-secondary)]">
                        {formatFileSize(uploadedFile.size)}
                      </p>
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setUploadedFile(null);
                        if (fileInputRef.current) fileInputRef.current.value = "";
                      }}
                      className="ml-2 p-1 rounded-lg hover:bg-gray-100 transition-colors"
                    >
                      <X className="w-4 h-4 text-[var(--text-secondary)]" />
                    </button>
                  </div>
                ) : (
                  <>
                    <Upload className="w-10 h-10 text-[var(--text-secondary)] mx-auto mb-3" />
                    <p className="text-sm text-[var(--text-secondary)]">
                      Arraste um arquivo aqui ou{" "}
                      <span className="text-purple-600 font-medium">
                        clique para selecionar
                      </span>
                    </p>
                    <p className="text-xs text-[var(--text-secondary)] mt-1.5 opacity-60">
                      MP4, MP3, WAV, M4A, WebM, OGG, AVI, MOV — até 100MB
                    </p>
                  </>
                )}
              </div>
            </div>
          )}

          {/* Progress bar */}
          {status === "loading" && (
            <div className="mt-6">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-[var(--text-secondary)]">
                  {progressMsg || "Processando..."}
                </span>
                <span className="text-xs text-purple-600 font-mono">
                  {Math.round(progress)}%
                </span>
              </div>
              <div className="w-full h-1.5 bg-[var(--bg-primary)] rounded-full overflow-hidden">
                <div
                  className="progress-bar h-full rounded-full transition-all duration-500"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
          )}

          {/* Error message */}
          {status === "error" && (
            <div className="mt-6 flex items-start gap-3 p-4 rounded-xl bg-red-500/10 border border-red-500/20">
              <AlertCircle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
              <p className="text-sm text-red-600">{errorMsg}</p>
            </div>
          )}

          {/* Transcribe button */}
          <button
            onClick={handleTranscribe}
            disabled={
              status === "loading" ||
              (activeTab === "youtube" && !youtubeUrl.trim()) ||
              (activeTab === "upload" && !uploadedFile)
            }
            className="btn-primary w-full mt-6 py-3.5 rounded-xl text-sm font-semibold text-white flex items-center justify-center gap-2"
          >
            {status === "loading" ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Processando...
              </>
            ) : (
              <>
                <Wand2 className="w-4 h-4" />
                Transcrever com IA
              </>
            )}
          </button>
        </div>

        {/* Results */}
        {status === "success" && transcript && (
          <div className="mt-8 glass-strong rounded-2xl p-6 sm:p-8 glow-purple-sm">
            {/* Result header */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
              <div>
                <h2 className="text-lg font-semibold text-gray-800 flex items-center gap-2">
                  <Volume2 className="w-5 h-5 text-purple-600" />
                  Transcrição
                </h2>
                <div className="flex items-center gap-3 mt-1.5 text-xs text-[var(--text-secondary)]">
                  {videoTitle && <span className="truncate max-w-xs">{videoTitle}</span>}
                  {duration && (
                    <span className="flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {duration}
                    </span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleCopy}
                  className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-medium text-[var(--text-secondary)] hover:text-gray-800 hover:bg-gray-50 border border-[var(--border-color)] transition-all"
                >
                  {copied ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-green-400" />
                      Copiado!
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" />
                      Copiar
                    </>
                  )}
                </button>
                <button
                  onClick={handleDownload}
                  className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-medium text-[var(--text-secondary)] hover:text-gray-800 hover:bg-gray-50 border border-[var(--border-color)] transition-all"
                >
                  <Download className="w-3.5 h-3.5" />
                  .TXT
                </button>
              </div>
            </div>

            {/* Transcript text */}
            <div className="transcript-box rounded-xl p-5 max-h-[500px] overflow-y-auto">
              <p className="text-sm text-[var(--text-primary)] whitespace-pre-wrap leading-relaxed">
                {transcript}
              </p>
            </div>

            {/* Word count */}
            <div className="mt-4 text-xs text-[var(--text-secondary)] text-right">
              {transcript.split(/\s+/).length} palavras &middot;{" "}
              {transcript.length} caracteres
            </div>
          </div>
        )}

        {/* Footer */}
        <footer className="mt-12 text-center text-xs text-[var(--text-secondary)] opacity-50">
          Feito com Next.js + OpenAI Whisper
        </footer>
      </div>
    </div>
  );
}
