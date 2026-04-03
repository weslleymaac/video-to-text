import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Video Transcriber | AI-Powered Transcription",
  description: "Transcribe videos from YouTube or uploads using OpenAI Whisper AI",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="pt-BR">
      <body className="antialiased">{children}</body>
    </html>
  );
}
