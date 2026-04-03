import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { execSync } from "child_process";
import { writeFileSync, readFileSync, mkdtempSync, rmSync, readdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

function getClient() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY não configurada nas variáveis de ambiente.");
  }
  return new OpenAI({ apiKey });
}

function downloadYoutubeAudio(url: string) {
  const tmp = mkdtempSync(join(tmpdir(), "yt-"));

  // Get video info
  let title = "";
  let duration = "";
  try {
    const infoRaw = execSync(
      `yt-dlp --dump-json --no-download "${url}"`,
      { timeout: 30000, encoding: "utf-8" }
    );
    const info = JSON.parse(infoRaw);
    title = info.title || "";
    const durSecs = info.duration || 0;
    if (durSecs > 2.5 * 60 * 60) {
      rmSync(tmp, { recursive: true, force: true });
      throw new Error(`Vídeo muito longo (${Math.round(durSecs / 60)}min). O limite é 2h30.`);
    }
    if (durSecs) {
      const h = Math.floor(durSecs / 3600);
      const m = Math.floor((durSecs % 3600) / 60);
      const s = Math.floor(durSecs % 60);
      duration = h
        ? `${h}h ${String(m).padStart(2, "0")}m ${String(s).padStart(2, "0")}s`
        : `${m}m ${String(s).padStart(2, "0")}s`;
    }
  } catch (e: any) {
    if (e.message?.includes("limite")) throw e;
  }

  // Download audio
  execSync(
    `yt-dlp --extract-audio --audio-format mp3 --audio-quality 5 --no-playlist -o "${join(tmp, "audio.%(ext)s")}" "${url}"`,
    { timeout: 600000, encoding: "utf-8" }
  );

  return { filePath: join(tmp, "audio.mp3"), tmpDir: tmp, title, duration };
}

function splitAudio(filePath: string, tmpDir: string): string[] {
  const stats = readFileSync(filePath);
  if (stats.length <= 24 * 1024 * 1024) return [filePath];

  const chunksDir = join(tmpDir, "chunks");
  execSync(`mkdir -p "${chunksDir}"`);
  execSync(
    `ffmpeg -i "${filePath}" -f segment -segment_time 600 -c copy -reset_timestamps 1 "${join(chunksDir, "chunk_%03d.mp3")}"`,
    { timeout: 120000 }
  );

  const files = readdirSync(chunksDir)
    .filter((f) => f.startsWith("chunk_") && f.endsWith(".mp3"))
    .sort()
    .map((f) => join(chunksDir, f));

  if (files.length === 0) throw new Error("Erro ao dividir o áudio.");
  return files;
}

async function transcribeFile(client: OpenAI, filePath: string): Promise<string> {
  const fileBuffer = readFileSync(filePath);
  const file = new File([fileBuffer], "audio.mp3", { type: "audio/mpeg" });

  const transcript = await client.audio.transcriptions.create({
    model: "whisper-1",
    file,
    response_format: "text",
  });

  return transcript as unknown as string;
}

async function transcribeAudio(
  client: OpenAI,
  filePath: string,
  tmpDir: string
): Promise<string> {
  const chunks = splitAudio(filePath, tmpDir);
  const results: string[] = [];

  for (const chunk of chunks) {
    const text = await transcribeFile(client, chunk);
    results.push(text);
  }

  return results.join(" ");
}

export const maxDuration = 600; // 10 minutes

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

      const { filePath, tmpDir, title, duration } = downloadYoutubeAudio(youtubeUrl);

      try {
        const transcript = await transcribeAudio(client, filePath, tmpDir);
        return NextResponse.json({ transcript, title, duration });
      } finally {
        rmSync(tmpDir, { recursive: true, force: true });
      }

    } else if (contentType.includes("multipart/form-data")) {
      // Upload mode
      const formData = await request.formData();
      const file = formData.get("file") as File | null;

      if (!file) {
        return NextResponse.json({ error: "Nenhum arquivo enviado." }, { status: 400 });
      }

      const tmp = mkdtempSync(join(tmpdir(), "upload-"));
      const filePath = join(tmp, file.name);
      const bytes = await file.arrayBuffer();
      writeFileSync(filePath, Buffer.from(bytes));

      try {
        const transcript = await transcribeAudio(client, filePath, tmp);
        return NextResponse.json({ transcript, title: file.name, duration: "" });
      } finally {
        rmSync(tmp, { recursive: true, force: true });
      }

    } else {
      return NextResponse.json({ error: "Content-Type não suportado." }, { status: 400 });
    }
  } catch (e: any) {
    const msg = e.message || "Erro interno do servidor.";
    const status = msg.includes("limite") || msg.includes("obrigatória") || msg.includes("inválida") ? 400 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
