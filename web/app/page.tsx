"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import {
  ArrowRight, AudioLines, Check, Copy, Download, Focus, Heart, MonitorUp, Play,
  ShieldCheck, X,
} from "lucide-react";
import PromoFilm from "./PromoFilm";
import ScreenshotCarousel from "./ScreenshotCarousel";
import { screenshotSrc } from "../lib/screenshots";

const UPI_ID = "rushikeshingale2001@okicici";

function BrandMark() {
  return <Image className="brand-mark" src="/snap-logo.png" alt="" width={256} height={256} aria-hidden="true" />;
}

function DownloadButton({ light = false }: { light?: boolean }) {
  return (
    <a className={`button button-primary${light ? " button-light" : ""}`} href="/download">
      <Download size={16} /> Download for Windows <ArrowRight size={15} />
    </a>
  );
}

const workflowShots = [
  { title: "Record your way.", file: "recorder.webp", alt: "Snap recorder showing Full Screen, Custom, Window and Device capture options", description: "A screen, a window, a region, or a connected device.", wide: true },
  { title: "Bring in what you have.", file: "media-import.webp", alt: "Snap's dashed drag-and-drop media import area and recent recordings", description: "Drop in a video and pick up from there.", wide: false },
  { title: "Stay on script.", file: "teleprompter.webp", alt: "Snap teleprompter with highlighted script text and speaking speed controls", description: "Your talking points, right where you need them.", wide: false },
] as const;

export default function Home() {
  const [donateOpen, setDonateOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!donateOpen) return;
    const close = (event: KeyboardEvent) => event.key === "Escape" && setDonateOpen(false);
    document.body.classList.add("modal-open");
    window.addEventListener("keydown", close);
    return () => {
      document.body.classList.remove("modal-open");
      window.removeEventListener("keydown", close);
    };
  }, [donateOpen]);

  const copyUpiId = async () => {
    try {
      await navigator.clipboard.writeText(UPI_ID);
    } catch {
      const field = document.createElement("textarea");
      field.value = UPI_ID;
      field.style.position = "fixed";
      field.style.opacity = "0";
      document.body.appendChild(field);
      field.select();
      document.execCommand("copy");
      field.remove();
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };

  return (
    <div className="site-frame" id="top">
      <header className="site-nav shell">
        <a className="brand" href="#top" aria-label="Snap home"><BrandMark /><strong>Snap</strong></a>
        <nav aria-label="Primary navigation">
          <a href="#product">Product</a><a href="#workflow">Workflow</a>
        </nav>
        <div className="nav-actions">
          <button className="text-button" onClick={() => setDonateOpen(true)}><Heart size={15} /> Support</button>
          <a className="nav-download" href="/download">Get Snap <ArrowRight size={14} /></a>
        </div>
      </header>

      <main>
        <section className="hero shell">
          <div className="hero-sky">
            <span className="cloud cloud-one" /><span className="cloud cloud-two" />
            <div className="hero-copy">
              <h1>Record the screen.<br /><span className="accent-line">Direct the attention.</span></h1>
              <p>A lightweight Windows recorder with an editor that adds camera movement, cursor clarity, captions, and polish—without sending your work to the cloud.</p>
              <div className="hero-actions">
                <DownloadButton />
                <a className="button button-secondary" href="#film">Watch the film <Play size={15} /></a>
              </div>
            </div>
          </div>

          <ScreenshotCarousel />
        </section>

        <PromoFilm />

        <section className="real-workflow shell" aria-labelledby="real-workflow-title">
          <div className="real-workflow-heading"><span className="section-kicker">The actual app</span><h2 id="real-workflow-title">A small studio.<br />Right on your desktop.</h2></div>
          <div className="real-workflow-grid">
            {workflowShots.map(shot => <article className={shot.wide ? "is-wide" : ""} key={shot.file}>
              <div className="real-workflow-image"><Image src={screenshotSrc(shot.file)} alt={shot.alt} width={1180} height={shot.wide ? 340 : 600} unoptimized sizes="(max-width: 760px) 90vw, 650px" /></div>
              <div><h3>{shot.title}</h3><p>{shot.description}</p></div>
            </article>)}
          </div>
        </section>

        <section className="workflow shell" id="workflow">
          <div className="workflow-top"><h2>From capture to a video<br />that feels deliberately made.</h2></div>
          <div className="workflow-grid">
            <article><MonitorUp /><h3>Record lightly</h3><p>Native Windows capture stays out of the way while you work, play, or present.</p></article>
            <article><Focus /><h3>Shape the focus</h3><p>Review the automatic camera pass and adjust any region directly on the timeline.</p></article>
            <article><AudioLines /><h3>Finish the sound</h3><p>Balance desktop and microphone tracks independently, then add captions when needed.</p></article>
            <article><Download /><h3>Export with confidence</h3><p>Render an MP4 with the canvas, motion, cursor, layers, and captions baked in.</p></article>
          </div>
        </section>

        <section className="closing shell">
          <div><h2>Make the screen<br /><span className="accent-line">feel like a camera.</span></h2></div>
          <div className="closing-actions">
            <p>Free to download for Windows. Local-first by design, with no account required.</p>
            <DownloadButton light />
            <button className="support-button" onClick={() => setDonateOpen(true)}><Heart size={16} /> Support independent development</button>
          </div>
        </section>
      </main>

      <footer className="site-footer shell">
        <p>Made with <span aria-label="love">💙</span> By <a href="https://venusapp.in" target="_blank" rel="noreferrer">Veil</a></p>
      </footer>

      {donateOpen && (
        <div className="donate-backdrop" onPointerDown={() => setDonateOpen(false)}>
          <section className="donate-dialog" role="dialog" aria-modal="true" aria-labelledby="donate-title" onPointerDown={(event) => event.stopPropagation()}>
            <button className="donate-close" onClick={() => setDonateOpen(false)} aria-label="Close donation panel"><X size={18} /></button>
            <div className="donate-copy">
              <BrandMark />
              <h2 id="donate-title">Help build the<br /><span className="accent-line">next Snap.</span></h2>
              <p>Contributions go back into capture reliability, smarter motion, faster exports, and a calmer editing experience.</p>
              <div><ShieldCheck size={16} /> Payment stays inside your UPI app.</div>
            </div>
            <div className="donate-payment">
              <div className="qr"><Image src="/donate.jpeg" alt="UPI QR code for donating to Snap" fill sizes="260px" /></div>
              <small>UPI ID</small><strong>{UPI_ID}</strong>
              <button onClick={() => void copyUpiId()}>{copied ? <Check size={16} /> : <Copy size={16} />}{copied ? "Copied" : "Copy UPI ID"}</button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
