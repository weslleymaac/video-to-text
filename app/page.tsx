"use client";

import { useState, useRef, useCallback } from "react";
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
} from "lucide-react";

type TabType = "youtube" | "upload";
type Status = "idle" | "loading" | "success" | "error";

export default function Home() {
  const [activeTab, setActiveTab] = useState<TabType>("youtube");
  const [youtubeUrl, setYoutubeUrl] = useState("");
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [transcript, setTranscript] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [progress, setProgress] = useState(0);
  const [errorMsg, setErrorMsg] = useState("");
  const [copied, setCopied] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [videoTitle, setVideoTitle] = useState("");
  const [duration, setDuration] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleTranscribe = async () => {
    setStatus("loading");
    setTranscript("");
    setErrorMsg("");
    setProgress(0);
    setVideoTitle("");
    setDuration("");

    const progressInterval = setInterval(() => {
      setProgress((prev) => {
        if (prev >= 95) return prev;
        const increment = prev < 30 ? Math.random() * 5 : prev < 60 ? Math.random() * 3 : Math.random() * 1;
        return Math.min(prev + increment, 95);
      });
    }, 1500);

    try {
      let response: Response;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10 * 60 * 1000); // 10 min timeout

      if (activeTab === "youtube") {
        if (!youtubeUrl.trim()) {
          throw new Error("Por favor, insira o link do YouTube.");
        }
        response = await fetch("/api/transcribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ youtube_url: youtubeUrl.trim() }),
          signal: controller.signal,
        });
      } else {
        if (!uploadedFile) {
          throw new Error("Por favor, selecione um arquivo de vídeo/áudio.");
        }
        const formData = new FormData();
        formData.append("file", uploadedFile);
        response = await fetch("/api/transcribe", {
          method: "POST",
          body: formData,
          signal: controller.signal,
        });
      }

      clearTimeout(timeoutId);

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Erro ao transcrever o vídeo.");
      }

      setProgress(100);
      setTranscript(data.transcript);
      if (data.title) setVideoTitle(data.title);
      if (data.duration) setDuration(data.duration);
      setStatus("success");
    } catch (err: any) {
      if (err.name === "AbortError") {
        setErrorMsg("Timeout: o processamento demorou mais de 10 minutos. Tente um vídeo mais curto.");
      } else {
        setErrorMsg(err.message || "Erro inesperado.");
      }
      setStatus("error");
    } finally {
      clearInterval(progressInterval);
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
    if (file) {
      setUploadedFile(file);
    }
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

  return (
    <div className="min-h-screen dot-pattern relative">
      {/* Background gradient orbs */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -left-40 w-96 h-96 bg-purple-300/20 rounded-full blur-[120px] animate-pulse-slow" />
        <div className="absolute top-1/3 -right-40 w-80 h-80 bg-violet-300/20 rounded-full blur-[100px] animate-pulse-slow" />
        <div className="absolute -bottom-40 left-1/3 w-72 h-72 bg-indigo-300/15 rounded-full blur-[100px] animate-pulse-slow" />
      </div>

      <div className="relative z-10 max-w-3xl mx-auto px-4 sm:px-6 py-10 sm:py-16">
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
                Arquivo de vídeo ou áudio
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
                      MP4, MP3, WAV, M4A, WebM, OGG, AVI, MOV
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
                  {progress < 30 ? "Baixando áudio..." : progress < 70 ? "Transcrevendo com IA..." : "Finalizando..."}
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
                Transcrevendo...
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
          Feito com Next.js + Python + OpenAI Whisper
        </footer>
      </div>
    </div>
  );
}
