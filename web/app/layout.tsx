import type { Metadata } from "next";
import { Space_Grotesk } from "next/font/google";
import "./globals.css";

const spaceGrotesk = Space_Grotesk({ variable: "--font-space-grotesk", subsets: ["latin"], display: "swap" });

export function generateMetadata(): Metadata {
  const host = process.env.VERCEL_PROJECT_PRODUCTION_URL ?? "snap-screen-recorder.vercel.app";
  const siteUrl = new URL(`https://${host}`);
  const ogImage = new URL("/screenshots/editor-dark.webp", siteUrl).toString();
  const title = "Snap — Your screen recording, already directed";
  const description = "A native Windows screen recorder and editor with editable Auto Zoom, separate audio tracks, cursor motion, mobile capture, and polished exports.";

  return {
    title,
    description,
    metadataBase: siteUrl,
    icons: { icon: "/snap-logo.png", shortcut: "/snap-logo.png", apple: "/snap-logo.png" },
    openGraph: { title, description, type: "website", images: [{ url: ogImage, width: 1914, height: 1022, alt: "The actual Snap editor with cursor controls and a multi-track timeline" }] },
    twitter: { card: "summary_large_image", title, description, images: [ogImage] },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${spaceGrotesk.className} ${spaceGrotesk.variable}`}>{children}</body>
    </html>
  );
}
