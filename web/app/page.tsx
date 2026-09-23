"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import {
  ArrowRight, AudioLines, Captions, Check, Copy, Download, Focus, Heart,
  Layers3, MonitorUp, MousePointer2, ShieldCheck, Sparkles, WandSparkles,
  X, Zap,
} from "lucide-react";

const UPI_ID = "rushikeshingale2001@okicici";

function BrandMark() {
  return <span className="brand-mark" aria-hidden="true"><i /><i /><i /><i /></span>;
}

function DownloadButton({ light = false }: { light?: boolean }) {
  return (
    <a className={`button button-primary${light ? " button-light" : ""}`} href="/download">
      <Download size={16} /> Download for Windows <ArrowRight size={15} />
    </a>
  );
}

const tools = [
  {
    eyebrow: "Motion", title: "Movement with a reason.",
    copy: "Turn clicks into smooth camera moves, tune the response, and add motion blur only where it helps the story.",
    image: "/Motion.png", width: 480, height: 720, icon: WandSparkles, tone: "peach", layout: "portrait",
  },
  {
    eyebrow: "Cursor", title: "Make every interaction readable.",
    copy: "Style the pointer, smooth its travel, and choose click effects that guide attention without taking it over.",
    image: "/Cursor.png", width: 1920, height: 1080, icon: MousePointer2, tone: "sky", layout: "wide",
  },
  {
    eyebrow: "Captions", title: "Words that arrive on cue.",
    copy: "Generate captions locally, then refine timing, typography, spacing, color, and animation inside the same edit.",
    image: "/Caption.png", width: 480, height: 720, icon: Captions, tone: "sage", layout: "portrait",
  },
  {
    eyebrow: "Layers & effects", title: "Explain more than the recording can.",
    copy: "Add text, shapes, highlights, masks, and image layers directly to the timeline without leaving Snap.",
    image: "/Effects.png", width: 1920, height: 1080, icon: Layers3, tone: "lilac", layout: "wide",
  },
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
          <a href="#product">Product</a><a href="#tools">Tools</a><a href="#workflow">Workflow</a>
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
              <div className="eyebrow-pill"><Sparkles size={13} /> Snap 8 is ready</div>
              <h1>Record the screen.<br /><em>Direct the attention.</em></h1>
              <p>A lightweight Windows recorder with an editor that adds camera movement, cursor clarity, captions, and polish—without sending your work to the cloud.</p>
              <div className="hero-actions">
                <DownloadButton />
                <a className="button button-secondary" href="#product">See how it works <ArrowRight size={15} /></a>
              </div>
            </div>
            <div className="hero-badges">
              <span><Zap size={14} /> Hardware capture</span>
              <span><ShieldCheck size={14} /> Local-first</span>
              <span><MonitorUp size={14} /> Windows 10 / 11</span>
            </div>
          </div>

          <div className="hero-product" id="product">
            <div className="window-bar">
              <span><BrandMark /> Snap Editor</span><small>snap_1789989309422.mp4</small><i /><i /><i />
            </div>
            <Image src="/EditorPreview.png" alt="Snap editor showing canvas controls, video preview, audio waveforms, zoom regions, and captions" width={1920} height={1080} loading="eager" sizes="(max-width: 900px) 94vw, 1240px" />
          </div>
        </section>

        <section className="proof shell" aria-label="Snap product facts">
          <div><strong>60 FPS</strong><span>hardware-oriented capture</span></div>
          <div><strong>2 tracks</strong><span>desktop + microphone audio</span></div>
          <div><strong>Local</strong><span>record, caption, and export privately</span></div>
          <div><strong>Editable</strong><span>every zoom remains under your control</span></div>
        </section>

        <section className="manifesto shell">
          <span className="section-label">Built for showing, not fixing</span>
          <div>
            <h2>Your recording already knows<br />where the story happened.</h2>
            <p>Snap remembers the clicks, pointer movement, audio, and timing behind every take. The editor turns those signals into a first pass you can shape instead of starting from an empty timeline.</p>
          </div>
        </section>

        <section className="focus-feature shell">
          <div className="focus-copy">
            <span className="feature-number">01</span><Focus size={21} />
            <span className="section-label">The edit system</span>
            <h2>A polished frame,<br />before you touch a keyframe.</h2>
            <p>Choose a canvas, set the padding and corners, then let Auto Zoom build a clean camera path from the moments that matter.</p>
            <ul>
              <li><Check size={15} /> Editable Auto Zoom regions</li>
              <li><Check size={15} /> Backgrounds, images, gradients, and shadows</li>
              <li><Check size={15} /> Multitrack audio and caption timeline</li>
            </ul>
          </div>
          <div className="focus-image">
            <Image src="/EditorPreview.png" alt="Snap canvas and timeline editor" width={1920} height={1080} sizes="(max-width: 900px) 90vw, 720px" />
          </div>
        </section>

        <section className="tools shell" id="tools">
          <div className="section-heading">
            <span className="section-label">A complete toolset</span>
            <h2>Small controls.<br /><em>Big difference.</em></h2>
            <p>Everything is arranged around the preview, so the work stays visual and the settings stay close to what they change.</p>
          </div>

          <div className="tool-grid">
            {tools.map(({ eyebrow, title, copy, image, width, height, icon: Icon, tone, layout }) => (
              <article className={`tool-card tool-${layout} tone-${tone}`} key={eyebrow}>
                <div className="tool-copy">
                  <span className="tool-icon"><Icon size={18} /></span><small>{eyebrow}</small>
                  <h3>{title}</h3><p>{copy}</p>
                </div>
                <div className="tool-image">
                  <Image src={image} alt={`${eyebrow} controls in Snap`} width={width} height={height} sizes={layout === "wide" ? "(max-width: 900px) 90vw, 760px" : "(max-width: 900px) 90vw, 360px"} />
                </div>
              </article>
            ))}
          </div>

          <article className="caption-feature">
            <div className="caption-preview"><Image src="/Audio.png" alt="Automatic caption generation panel in Snap" width={480} height={720} sizes="(max-width: 760px) 85vw, 380px" /></div>
            <div className="caption-copy">
              <span className="section-label">Offline captions</span>
              <h2>Turn speech into<br />a designed layer.</h2>
              <p>Pick an installed model, detect the language, generate locally, and refine every caption without uploading the recording.</p>
              <div className="mini-facts">
                <span><strong>Private</strong>Runs on your PC</span>
                <span><strong>Flexible</strong>Burn in or export a sidecar</span>
              </div>
            </div>
          </article>
        </section>

        <section className="workflow shell" id="workflow">
          <div className="workflow-top"><span className="section-label">One continuous flow</span><h2>From capture to a video<br />that feels deliberately made.</h2></div>
          <div className="workflow-grid">
            <article><span>01</span><MonitorUp /><h3>Record lightly</h3><p>Native Windows capture stays out of the way while you work, play, or present.</p></article>
            <article><span>02</span><Focus /><h3>Shape the focus</h3><p>Review the automatic camera pass and adjust any region directly on the timeline.</p></article>
            <article><span>03</span><AudioLines /><h3>Finish the sound</h3><p>Balance desktop and microphone tracks independently, then add captions when needed.</p></article>
            <article><span>04</span><Download /><h3>Export with confidence</h3><p>Render an MP4 with the canvas, motion, cursor, layers, and captions baked in.</p></article>
          </div>
        </section>

        <section className="closing shell">
          <div className="closing-orb"><BrandMark /></div>
          <div><span className="section-label">Snap v8.0.0</span><h2>Make the screen<br /><em>feel like a camera.</em></h2></div>
          <div className="closing-actions">
            <p>Free to download for Windows. Local-first by design, with no account required.</p>
            <DownloadButton light />
            <button className="support-button" onClick={() => setDonateOpen(true)}><Heart size={16} /> Support independent development</button>
          </div>
        </section>
      </main>

      <footer className="site-footer shell">
        <a className="brand" href="#top"><BrandMark /><strong>Snap</strong></a>
        <p>Screen recording with a point of view.</p><p>Windows · v8.0.0 · 2026</p>
      </footer>

      {donateOpen && (
        <div className="donate-backdrop" onPointerDown={() => setDonateOpen(false)}>
          <section className="donate-dialog" role="dialog" aria-modal="true" aria-labelledby="donate-title" onPointerDown={(event) => event.stopPropagation()}>
            <button className="donate-close" onClick={() => setDonateOpen(false)} aria-label="Close donation panel"><X size={18} /></button>
            <div className="donate-copy">
              <BrandMark /><span className="section-label">Support independent software</span>
              <h2 id="donate-title">Help build the<br /><em>next Snap.</em></h2>
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
