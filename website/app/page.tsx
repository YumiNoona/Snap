"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import {
  AudioLines,
  Check,
  ChevronRight,
  CircleDot,
  Copy,
  Download,
  Focus,
  Gauge,
  Heart,
  Layers3,
  Mic2,
  MonitorUp,
  MousePointer2,
  ScanLine,
  ShieldCheck,
  Smartphone,
  Sparkles,
  WandSparkles,
  X,
} from "lucide-react";

const UPI_ID = "rushikeshingale2001@okicici";

function BrandMark({ muted = false }: { muted?: boolean }) {
  return (
    <span className={`snap-mark${muted ? " snap-mark-muted" : ""}`} aria-hidden="true">
      <span className="snap-mark-layer snap-mark-layer-back" />
      <span className="snap-mark-layer snap-mark-layer-front"><Focus size={18} strokeWidth={2.3} /></span>
    </span>
  );
}

function DownloadButton({ compact = false }: { compact?: boolean }) {
  return (
    <a className={`action action-download${compact ? " action-compact" : ""}`} href="/download">
      <Download size={17} strokeWidth={2.2} />
      <span>Download Snap</span>
      {!compact && <ChevronRight className="action-tail" size={16} />}
    </a>
  );
}

function DonateButton({ onClick, compact = false }: { onClick: () => void; compact?: boolean }) {
  return (
    <button className={`action action-donate${compact ? " action-compact" : ""}`} onClick={onClick}>
      <Heart size={17} strokeWidth={2.2} />
      <span>Donate</span>
    </button>
  );
}

const featureCards = [
  {
    icon: Focus,
    label: "Auto Zoom",
    title: "The camera follows the story.",
    copy: "Clicks become editable focus regions with natural pacing, smooth curves, and targets you can move at any time.",
    className: "feature-auto",
  },
  {
    icon: AudioLines,
    label: "Separate audio",
    title: "Two tracks. Zero compromises.",
    copy: "Desktop and microphone audio remain independent, synchronized, and ready to mute or tune directly in the timeline.",
    className: "feature-audio",
  },
  {
    icon: MousePointer2,
    label: "Cursor motion",
    title: "Movement that feels intentional.",
    copy: "Smooth pointer travel, choose a cursor style, add click effects, and keep every interaction readable without distraction.",
    className: "feature-cursor",
  },
  {
    icon: Smartphone,
    label: "Mobile recording",
    title: "Phone capture joins the same edit.",
    copy: "Record Android or iPhone video with synchronized audio, recovery-safe saving, and the same automatic zoom workflow.",
    className: "feature-mobile",
  },
];

export default function Home() {
  const [donateOpen, setDonateOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!donateOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDonateOpen(false);
    };
    document.body.classList.add("modal-open");
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.classList.remove("modal-open");
      window.removeEventListener("keydown", onKeyDown);
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
    <main className="snap-site">
      <header className="site-header shell">
        <a className="brand" href="#top" aria-label="Snap home">
          <BrandMark />
          <span className="brand-copy"><strong>Snap</strong><small>Screen Studio</small></span>
        </a>
        <div className="header-status"><span /> Native Windows capture</div>
        <div className="header-actions">
          <DonateButton compact onClick={() => setDonateOpen(true)} />
          <DownloadButton compact />
        </div>
      </header>

      <section className="hero shell" id="top">
        <div className="hero-copy">
          <div className="hero-kicker"><Sparkles size={14} /> Record once. Finish in Snap.</div>
          <h1>Your screen recording,<br /><span>already directed.</span></h1>
          <p>Snap records every click, sound, and movement—then turns them into an editable camera system made for clear, polished videos.</p>
          <div className="hero-actions">
            <DownloadButton />
            <DonateButton onClick={() => setDonateOpen(true)} />
          </div>
          <div className="hero-trust">
            <span><Gauge size={15} /> Hardware accelerated</span>
            <span><ShieldCheck size={15} /> Local-first</span>
            <span><CircleDot size={15} /> 60 FPS</span>
          </div>
        </div>

        <div className="product-stage">
          <div className="stage-glow" />
          <div className="stage-orbit stage-orbit-one" />
          <div className="stage-orbit stage-orbit-two" />
          <div className="product-window">
            <div className="product-topbar">
              <span className="product-brand"><BrandMark muted /> Snap Editor</span>
              <span className="product-file">snap_1786441712922.mp4</span>
              <span className="product-dots"><i /><i /><i /></span>
            </div>
            <div className="product-image-wrap">
              <Image
                className="product-image"
                src="/editor-preview.png"
                alt="Snap editor with canvas controls and a multitrack timeline"
                width={1920}
                height={1041}
                priority
              />
            </div>
          </div>
          <div className="stage-chip chip-zoom"><Focus size={15} /> Auto Zoom <strong>1.9×</strong></div>
          <div className="stage-chip chip-audio"><AudioLines size={15} /> Two audio tracks</div>
          <div className="stage-chip chip-local"><ShieldCheck size={15} /> Saved locally</div>
        </div>
      </section>

      <section className="signal-bar" aria-label="Snap highlights">
        <div className="signal-track">
          <span><Focus /> Editable Auto Zoom</span><i />
          <span><Mic2 /> Desktop + microphone</span><i />
          <span><ScanLine /> Cursor intelligence</span><i />
          <span><MonitorUp /> Native Windows capture</span><i />
          <span><Focus /> Editable Auto Zoom</span>
        </div>
      </section>

      <section className="features shell">
        <div className="section-intro">
          <span className="section-index">01 — THE EDIT SYSTEM</span>
          <h2>Everything your recording<br />needs. Nothing it doesn’t.</h2>
          <p>Designed as one continuous workflow instead of a pile of disconnected tools.</p>
        </div>

        <div className="feature-grid">
          {featureCards.map(({ icon: Icon, label, title, copy, className }) => (
            <article className={`feature-card ${className}`} key={label}>
              <div className="feature-card-head"><span className="feature-icon"><Icon size={21} /></span><small>{label}</small></div>
              {className === "feature-auto" && (
                <div className="auto-visual" aria-hidden="true">
                  <div className="auto-screen"><span className="focus-node focus-node-one" /><span className="focus-node focus-node-two" /><span className="focus-path" /></div>
                  <div className="auto-timeline"><span /><strong>1.8×</strong><span /></div>
                </div>
              )}
              {className === "feature-audio" && (
                <div className="audio-visual" aria-hidden="true">
                  <div><Mic2 size={14} />{Array.from({ length: 17 }).map((_, index) => <i key={`mic-${index}`} style={{ height: `${12 + ((index * 13) % 34)}px` }} />)}</div>
                  <div><MonitorUp size={14} />{Array.from({ length: 17 }).map((_, index) => <i key={`desk-${index}`} style={{ height: `${10 + ((index * 17) % 37)}px` }} />)}</div>
                </div>
              )}
              {className === "feature-cursor" && (
                <div className="cursor-visual" aria-hidden="true">
                  <span><MousePointer2 /></span><span><MousePointer2 fill="currentColor" /></span><span><Sparkles /></span><span><CircleDot /></span>
                </div>
              )}
              {className === "feature-mobile" && (
                <div className="mobile-visual" aria-hidden="true">
                  <span className="phone-frame"><i /></span><span className="mobile-link"><i /><i /><i /></span><span className="desktop-frame"><Focus /></span>
                </div>
              )}
              <h3>{title}</h3>
              <p>{copy}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="workflow shell">
        <div className="workflow-heading">
          <span className="section-index">02 — ONE FLOW</span>
          <h2>Capture to export,<br />without changing context.</h2>
        </div>
        <div className="workflow-steps">
          <article><span>01</span><MonitorUp /><div><h3>Record</h3><p>Choose a screen, window, region, or connected phone.</p></div></article>
          <article><span>02</span><WandSparkles /><div><h3>Shape</h3><p>Adjust zooms, audio, cursor, canvas, text, and masks.</p></div></article>
          <article><span>03</span><Layers3 /><div><h3>Export</h3><p>Render a polished MP4 using the settings you actually need.</p></div></article>
        </div>
      </section>

      <section className="final-cta shell">
        <div className="cta-orb"><BrandMark /><span>1.0</span></div>
        <div>
          <span className="section-index">AVAILABLE FOR WINDOWS 10 / 11</span>
          <h2>Make the screen<br />feel like a camera.</h2>
        </div>
        <div className="cta-actions">
          <p>Download the latest release, or support the independent work behind Snap.</p>
          <DownloadButton />
          <DonateButton onClick={() => setDonateOpen(true)} />
        </div>
      </section>

      <footer className="site-footer shell">
        <div className="brand"><BrandMark muted /><span className="brand-copy"><strong>Snap</strong><small>Screen Studio</small></span></div>
        <p>Recording tools with a point of view.</p>
        <p>Windows · v5.0.0 · 2026</p>
      </footer>

      {donateOpen && (
        <div className="donate-backdrop" onPointerDown={() => setDonateOpen(false)}>
          <section className="donate-dialog" role="dialog" aria-modal="true" aria-labelledby="donate-title" onPointerDown={(event) => event.stopPropagation()}>
            <button className="donate-close" onClick={() => setDonateOpen(false)} aria-label="Close donation panel"><X size={19} /></button>
            <div className="donate-message">
              <BrandMark />
              <span className="section-index">SUPPORT INDEPENDENT SOFTWARE</span>
              <h2 id="donate-title">Help build the<br /><span>next Snap.</span></h2>
              <p>Every contribution goes back into capture reliability, smarter Auto Zoom, faster exports, and better editing tools.</p>
              <div className="donate-promise"><ShieldCheck size={16} /><span>Payment stays inside your UPI app. Snap never sees your payment information.</span></div>
            </div>
            <div className="donate-payment">
              <div className="qr-shell"><Image src="/donate.jpeg" alt="UPI QR code for donating to Snap" fill sizes="220px" priority /></div>
              <div className="payment-label"><span>UPI ID</span><small>Scan or copy</small></div>
              <strong>{UPI_ID}</strong>
              <button className={`copy-id${copied ? " copied" : ""}`} onClick={() => void copyUpiId()}>
                {copied ? <Check size={17} /> : <Copy size={17} />}
                <span>{copied ? "Copied to clipboard" : "Copy UPI ID"}</span>
              </button>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}
