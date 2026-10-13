"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import {
  ArrowRight, AudioLines, Check, Copy, Download, Focus, Heart, MonitorUp, Pause, Play,
  ShieldCheck, X,
} from "lucide-react";
import PromoFilm from "./PromoFilm";
import { productShots, screenshotSrc } from "../lib/screenshots";

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

const showcaseSlides = productShots.map(shot => ({ ...shot, image: screenshotSrc(shot.file) }));
const workflowShots = [
  { title: "Record your way.", file: "recorder.webp", alt: "Snap recorder showing Full Screen, Custom, Window and Device capture options", description: "A screen, a window, a region, or a connected device.", wide: true },
  { title: "Bring in what you have.", file: "media-import.webp", alt: "Snap's dashed drag-and-drop media import area and recent recordings", description: "Drop in a video and pick up from there.", wide: false },
  { title: "Stay on script.", file: "teleprompter.webp", alt: "Snap teleprompter with highlighted script text and speaking speed controls", description: "Your talking points, right where you need them.", wide: false },
] as const;

const showcaseTransitions = ["horizontal", "diagonal", "zoom", "reveal"] as const;
type ShowcaseTransition = (typeof showcaseTransitions)[number] | "drag";

function nextShowcaseTransition(current: ShowcaseTransition) {
  const options = showcaseTransitions.filter((transition) => transition !== current);
  return options[Math.floor(Math.random() * options.length)];
}

export default function Home() {
  const [donateOpen, setDonateOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [activeSlide, setActiveSlide] = useState(0);
  const [previousSlide, setPreviousSlide] = useState<number | null>(null);
  const [slideDirection, setSlideDirection] = useState<"next" | "previous">("next");
  const [slideTransition, setSlideTransition] = useState<ShowcaseTransition>("horizontal");
  const [dragOffset, setDragOffset] = useState(0);
  const [releaseOffset, setReleaseOffset] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [carouselPaused, setCarouselPaused] = useState(false);
  const [carouselHovered, setCarouselHovered] = useState(false);
  const activeSlideRef = useRef(0);
  const dragStartRef = useRef<number | null>(null);
  const dragOffsetRef = useRef(0);

  useEffect(() => {
    if (carouselPaused || carouselHovered || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const timer = window.setInterval(() => {
      if (dragStartRef.current !== null || document.hidden || document.activeElement?.closest(".showcase-carousel")) return;
      const current = activeSlideRef.current;
      const next = (current + 1) % showcaseSlides.length;
      setPreviousSlide(current);
      setSlideDirection("next");
      setSlideTransition((transition) => nextShowcaseTransition(transition));
      activeSlideRef.current = next;
      setActiveSlide(next);
    }, 5000);
    return () => window.clearInterval(timer);
  }, [carouselPaused, carouselHovered]);

  const showSlide = (requestedIndex: number, requestedDirection?: "next" | "previous", transitionOverride?: ShowcaseTransition) => {
    const current = activeSlideRef.current;
    const next = (requestedIndex + showcaseSlides.length) % showcaseSlides.length;
    if (next === current) return;
    setPreviousSlide(current);
    setSlideDirection(requestedDirection ?? (next > current ? "next" : "previous"));
    setSlideTransition((transition) => transitionOverride ?? nextShowcaseTransition(transition));
    activeSlideRef.current = next;
    setActiveSlide(next);
    dragOffsetRef.current = 0;
    setDragOffset(0);
  };

  const startShowcaseDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!event.isPrimary || event.button > 0) return;
    dragStartRef.current = event.clientX;
    dragOffsetRef.current = 0;
    setDragOffset(0);
    setIsDragging(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const moveShowcaseDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragStartRef.current === null) return;
    const offset = event.clientX - dragStartRef.current;
    dragOffsetRef.current = offset;
    setDragOffset(offset);
    if (Math.abs(offset) > 2) {
      const adjacent = (activeSlideRef.current + (offset < 0 ? 1 : -1) + showcaseSlides.length) % showcaseSlides.length;
      setPreviousSlide(adjacent);
    }
  };

  const finishShowcaseDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragStartRef.current === null) return;
    const offset = dragOffsetRef.current;
    const threshold = Math.min(110, event.currentTarget.clientWidth * .1);
    dragStartRef.current = null;
    setIsDragging(false);
    if (Math.abs(offset) >= threshold) {
      const direction = offset < 0 ? "next" : "previous";
      setReleaseOffset(offset);
      showSlide(activeSlideRef.current + (direction === "next" ? 1 : -1), direction, "drag");
    } else {
      dragOffsetRef.current = 0;
      setDragOffset(0);
    }
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

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

          <div className="showcase-carousel" id="product" aria-label="Snap editor features" onMouseEnter={() => setCarouselHovered(true)} onMouseLeave={() => setCarouselHovered(false)}>
            <div
              className={isDragging ? "showcase-stage is-dragging" : "showcase-stage"}
              data-direction={slideDirection}
              data-transition={slideTransition}
              style={{ "--release-offset": `${releaseOffset}px` } as CSSProperties}
              role="tabpanel"
              id="product-preview"
              aria-labelledby={`feature-${showcaseSlides[activeSlide].id}`}
              onPointerDown={startShowcaseDrag}
              onPointerMove={moveShowcaseDrag}
              onPointerUp={finishShowcaseDrag}
              onPointerCancel={finishShowcaseDrag}
            >
              {showcaseSlides.map((slide, index) => index !== activeSlide && index !== previousSlide ? null : (
                <Image
                  className={index === activeSlide ? "showcase-slide is-active" : index === previousSlide ? "showcase-slide is-previous" : "showcase-slide"}
                  src={slide.image}
                  alt={index === activeSlide ? slide.alt : ""}
                  aria-hidden={index !== activeSlide}
                  width={1920}
                  height={1032}
                  priority={index === 0}
                  unoptimized
                  sizes="(max-width: 900px) 96vw, 1280px"
                  draggable={false}
                  style={index === activeSlide && isDragging ? { transform: `translate3d(${dragOffset}px, 0, 0)` } : undefined}
                  key={slide.image}
                />
              ))}
              <span className="showcase-drag-hint" aria-hidden="true">Drag to explore</span>
            </div>
            <div className="showcase-navigation">
            <div className="showcase-tabs" role="tablist" aria-label="Choose a Snap feature" onKeyDown={event => {
              if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
              event.preventDefault();
              const next = event.key === "Home" ? 0 : event.key === "End" ? showcaseSlides.length - 1 : (activeSlideRef.current + (event.key === "ArrowRight" ? 1 : -1) + showcaseSlides.length) % showcaseSlides.length;
              showSlide(next); document.getElementById(`feature-${showcaseSlides[next].id}`)?.focus();
            }}>
              {showcaseSlides.map((slide, index) => (
                <button
                  className={index === activeSlide ? "is-active" : ""}
                  type="button"
                  role="tab"
                  id={`feature-${slide.id}`}
                  aria-controls="product-preview"
                  tabIndex={index === activeSlide ? 0 : -1}
                  aria-selected={index === activeSlide}
                  onClick={() => showSlide(index)}
                  key={slide.label}
                >
                  {slide.label}
                </button>
              ))}
            </div>
            <button className="showcase-pause" aria-label={carouselPaused ? "Resume screenshot rotation" : "Pause screenshot rotation"} onClick={() => setCarouselPaused(value => !value)}>{carouselPaused ? <Play size={14} /> : <Pause size={14} />}</button>
            </div>
          </div>
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
