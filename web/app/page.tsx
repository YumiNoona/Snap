"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import {
  ArrowRight, AudioLines, Check, ChevronLeft, ChevronRight, Copy, Download, Focus,
  Heart, MonitorUp, ShieldCheck, X,
} from "lucide-react";

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

const showcaseSlides = [
  {
    label: "Editor", image: "/EditorPreview.png",
    alt: "Snap editor showing canvas controls, video preview, audio waveforms, zoom regions, and captions",
  },
  {
    label: "Motion", image: "/Motion.png", alt: "Motion and camera movement controls in Snap",
  },
  {
    label: "Cursor", image: "/Cursor.png", alt: "Cursor styling controls in Snap",
  },
  {
    label: "Captions", image: "/Caption.png", alt: "Caption styling controls in Snap",
  },
  {
    label: "Effects", image: "/Effects.png", alt: "Layer and visual effect controls in Snap",
  },
  {
    label: "Audio", image: "/Audio.png", alt: "Audio and automatic caption controls in Snap",
  },
] as const;

export default function Home() {
  const [donateOpen, setDonateOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [activeSlide, setActiveSlide] = useState(0);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setActiveSlide((current) => (current + 1) % showcaseSlides.length);
    }, 5000);
    return () => window.clearInterval(timer);
  }, []);

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
                <a className="button button-secondary" href="#product">See how it works <ArrowRight size={15} /></a>
              </div>
            </div>
          </div>

          <div className="showcase-carousel" id="product" aria-label="Snap editor features">
            <div className="showcase-stage" aria-live="polite">
              {showcaseSlides.map((slide, index) => (
                <Image
                  className={index === activeSlide ? "showcase-slide is-active" : "showcase-slide"}
                  src={slide.image}
                  alt={slide.alt}
                  width={1920}
                  height={1032}
                  priority={index === 0}
                  sizes="(max-width: 900px) 96vw, 1280px"
                  key={slide.image}
                />
              ))}
              <button className="showcase-arrow showcase-arrow-left" type="button" aria-label="Previous screenshot" onClick={() => setActiveSlide((activeSlide - 1 + showcaseSlides.length) % showcaseSlides.length)}><ChevronLeft size={20} /></button>
              <button className="showcase-arrow showcase-arrow-right" type="button" aria-label="Next screenshot" onClick={() => setActiveSlide((activeSlide + 1) % showcaseSlides.length)}><ChevronRight size={20} /></button>
            </div>
            <div className="showcase-tabs" role="tablist" aria-label="Choose a Snap feature">
              {showcaseSlides.map((slide, index) => (
                <button
                  className={index === activeSlide ? "is-active" : ""}
                  type="button"
                  role="tab"
                  aria-selected={index === activeSlide}
                  onClick={() => setActiveSlide(index)}
                  key={slide.label}
                >
                  <span>{String(index + 1).padStart(2, "0")}</span>{slide.label}
                </button>
              ))}
            </div>
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
          <BrandMark />
          <div><span className="section-kicker">Ready when you are</span><h2>Make the screen<br /><span className="accent-line">feel like a camera.</span></h2></div>
          <div className="closing-actions">
            <p>Free to download for Windows. Local-first by design, with no account required.</p>
            <DownloadButton light />
            <button className="support-button" onClick={() => setDonateOpen(true)}><Heart size={16} /> Support independent development</button>
          </div>
        </section>
      </main>

      <footer className="site-footer shell">
        <a className="brand" href="#top"><BrandMark /><strong>Snap</strong></a>
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
