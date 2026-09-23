import type { Metadata } from "next";
import { JetBrains_Mono, Space_Grotesk } from "next/font/google";
import "./globals.css";

const spaceGrotesk = Space_Grotesk({ variable: "--font-space-grotesk", subsets: ["latin"], display: "swap" });
const jetBrainsMono = JetBrains_Mono({ variable: "--font-jetbrains-mono", subsets: ["latin"], display: "swap" });

export function generateMetadata(): Metadata {
  const host = process.env.VERCEL_PROJECT_PRODUCTION_URL ?? "snap-screen-recorder.vercel.app";
  const siteUrl = new URL(`https://${host}`);
  const ogImage = new URL("/EditorPreview.png", siteUrl).toString();
  const title = "Snap — Your screen recording, already directed";
  const description = "A native Windows screen recorder and editor with editable Auto Zoom, separate audio tracks, cursor motion, mobile capture, and polished exports.";

  return {
    title,
    description,
    metadataBase: siteUrl,
    openGraph: { title, description, type: "website", images: [{ url: ogImage, width: 1920, height: 1032, alt: "Snap screen recorder and editor" }] },
    twitter: { card: "summary_large_image", title, description, images: [ogImage] },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${spaceGrotesk.className} ${spaceGrotesk.variable} ${jetBrainsMono.variable}`}>{children}</body>
    </html>
  );
}
