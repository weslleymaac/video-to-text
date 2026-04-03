import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";

export const maxDuration = 300;

const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25MB - limite da API Whisper

function getClient() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY não configurada nas variáveis de ambiente.");
  return new OpenAI({ apiKey });
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h) return `${h}h ${String(m).padStart(2, "0")}m ${String(s).padStart(2, "0")}s`;
  return `${m}m ${String(s).padStart(2, "0")}s`;
}

async function downloadYoutubeAudio(url: string): Promise<{ buffer: Buffer; title: string; duration: string }> {
  const ytdl = (await import("@distube/ytdl-core")).default;

  const info = await ytdl.getInfo(url);
  const title = info.videoDetails.title;
  const durSecs = parseInt(info.videoDetails.lengthSeconds) || 0;

  if (durSecs > 2.5 * 60 * 60) {
    throw new Error(`Vídeo muito longo (${Math.round(durSecs / 60)}min). O limite é 2h30.`);
  }

  const duration = durSecs ? formatDuration(durSecs) : "";

  // Pegar formato de áudio apenas, menor qualidade para caber no limite
  const format = ytdl.chooseFormat(info.formats, {
    quality: "lowestaudio",
    filter: "audioonly",
  });

  if (!format) {
    throw new Error("Não foi possível encontrar um formato de áudio para este vídeo.");
  }

  // Baixar o áudio via fetch (funciona em serverless)
  const response = await fetch(format.url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    },
  });

  if (!response.ok) {
    throw new Error("Erro ao baixar o áudio do YouTube.");
  }

  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  if (buffer.length > MAX_FILE_SIZE) {
    throw new Error(
      `Áudio muito grande (${(buffer.length / (1024 * 1024)).toFixed(1)}MB). Limite: 25MB. Tente um vídeo mais curto.`
    );
  }

  return { buffer, title, duration };
}

export async function POST(request: NextRequest) {
  try {
    const client = getClient();
    const contentType = request.headers.get("content-type") || "";

    if (contentType.includes("application/json")) {
      // YouTube mode
      const data = await request.json();
      const youtubeUrl = (data.youtube_url || "").trim();

      if (!youtubeUrl) {
        return NextResponse.json({ error: "URL do YouTube é obrigatória." }, { status: 400 });
      }

      if (!youtubeUrl.includes("youtube.com") && !youtubeUrl.includes("youtu.be")) {
        return NextResponse.json({ error: "URL inválida. Insira um link válido do YouTube." }, { status: 400 });
      }

      const { buffer, title, duration } = await downloadYoutubeAudio(youtubeUrl);

      const file = new File([new Uint8Array(buffer)], "audio.webm", { type: "audio/webm" });
      const transcript = await client.audio.transcriptions.create({
        model: "whisper-1",
        file,
        response_format: "text",
      });

      return NextResponse.json({
        transcript: transcript as unknown as string,
        title,
        duration,
      });

    } else if (contentType.includes("multipart/form-data")) {
      // Upload mode
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
    const status = msg.includes("limite") || msg.includes("obrigatória") || msg.includes("inválida") || msg.includes("grande") ? 400 : 500;
    return NextResponse.json({ error: `Erro interno: ${msg}` }, { status });
  }
}
