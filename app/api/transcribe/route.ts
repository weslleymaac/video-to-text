import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { YoutubeTranscript } from "youtube-transcript";

export const maxDuration = 300;

const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25MB - limite da API Whisper

function getClient() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY não configurada nas variáveis de ambiente.");
  return new OpenAI({ apiKey });
}

function extractVideoId(url: string): string {
  const patterns = [
    /(?:youtube\.com\/watch\?v=)([a-zA-Z0-9_-]{11})/,
    /(?:youtu\.be\/)([a-zA-Z0-9_-]{11})/,
    /(?:youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,
    /(?:youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/,
  ];
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }
  throw new Error("Não foi possível extrair o ID do vídeo. Verifique o link.");
}

async function getYoutubeTranscript(url: string): Promise<{ transcript: string; title: string }> {
  const videoId = extractVideoId(url);

  const items = await YoutubeTranscript.fetchTranscript(videoId, { lang: "pt" }).catch(() =>
    YoutubeTranscript.fetchTranscript(videoId)
  );

  if (!items || items.length === 0) {
    throw new Error(
      "Este vídeo não possui legendas/transcrição disponível no YouTube. Use a aba Upload para enviar o arquivo de áudio."
    );
  }

  const transcript = items.map((item) => item.text).join(" ");
  return { transcript, title: videoId };
}

export async function POST(request: NextRequest) {
  try {
    const contentType = request.headers.get("content-type") || "";

    if (contentType.includes("application/json")) {
      // YouTube mode - busca legendas direto do YouTube
      const data = await request.json();
      const youtubeUrl = (data.youtube_url || "").trim();

      if (!youtubeUrl) {
        return NextResponse.json({ error: "URL do YouTube é obrigatória." }, { status: 400 });
      }

      if (!youtubeUrl.includes("youtube.com") && !youtubeUrl.includes("youtu.be")) {
        return NextResponse.json({ error: "URL inválida. Insira um link válido do YouTube." }, { status: 400 });
      }

      const { transcript, title } = await getYoutubeTranscript(youtubeUrl);

      return NextResponse.json({ transcript, title, duration: "" });

    } else if (contentType.includes("multipart/form-data")) {
      // Upload mode - transcreve com Whisper
      const client = getClient();
      const formData = await request.formData();
      const file = formData.get("file") as File | null;

      if (!file) {
        return NextResponse.json({ error: "Nenhum arquivo enviado." }, { status: 400 });
      }

      if (file.size > MAX_FILE_SIZE) {
        return NextResponse.json(
          { error: `Arquivo muito grande (${(file.size / (1024 * 1024)).toFixed(1)}MB). Limite: 25MB.` },
          { status: 400 }
        );
      }

      const transcript = await client.audio.transcriptions.create({
        model: "whisper-1",
        file,
        response_format: "text",
      });

      return NextResponse.json({
        transcript: transcript as unknown as string,
        title: file.name,
        duration: "",
      });

    } else {
      return NextResponse.json({ error: "Content-Type não suportado." }, { status: 400 });
    }
  } catch (e: any) {
    console.error("Transcribe error:", e);
    const msg = e.message || "Erro interno do servidor.";
    const status = msg.includes("obrigatória") || msg.includes("inválida") || msg.includes("grande") || msg.includes("legendas") ? 400 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
