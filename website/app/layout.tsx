import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export function generateMetadata(): Metadata {
  const host = process.env.VERCEL_PROJECT_PRODUCTION_URL ?? "snap-screen-recorder.vercel.app";
  const siteUrl = new URL(`https://${host}`);
  const ogImage = new URL("/og-v2.png", siteUrl).toString();
  const title = "Snap — Your screen recording, already directed";
  const description = "A native Windows screen recorder and editor with editable Auto Zoom, separate audio tracks, cursor motion, mobile capture, and polished exports.";

  return {
    title,
    description,
    metadataBase: siteUrl,
    openGraph: { title, description, type: "website", images: [{ url: ogImage, width: 1729, height: 910, alt: "Snap screen recorder and editor" }] },
    twitter: { card: "summary_large_image", title, description, images: [ogImage] },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable}`}>{children}</body>
    </html>
  );
}
