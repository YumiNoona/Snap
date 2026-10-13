"use client";

import { useRef, useState } from "react";
import { ArrowDownToLine, Play } from "lucide-react";

export default function PromoFilm() {
  const video = useRef<HTMLVideoElement>(null);
  const [started, setStarted] = useState(false);
  const [error, setError] = useState(false);
  const start = async () => {
    if (!video.current) return;
    setError(false);
    // Reveal native controls before playback; a failure leaves a usable retry.
    setStarted(true);
    try { await video.current.play(); } catch { setStarted(false); setError(true); }
  };
  return (
    <section className="product-film shell" id="film" aria-labelledby="film-title">
      <div className="film-heading">
        <div><span className="section-kicker">A little tour</span><h2 id="film-title">Meet Snap.<br /><span>In 25 seconds.</span></h2></div>
        <p>Your screen, a smoother camera pass, and the finishing touches that make it yours.</p>
      </div>
      <div className={`film-player${started ? " is-started" : ""}`}>
        <video ref={video} poster="/media/snap-promo-poster.webp" preload="none" playsInline controls={started} muted aria-label="Snap product film, 25 seconds" onError={() => setError(true)}>
          <source src="/media/snap-promo.mp4" type="video/mp4" />
          <track kind="captions" src="/media/snap-promo.vtt" srcLang="en" label="English feature titles" />
          Your browser does not support this video. <a href="/media/snap-promo.mp4">Download the film.</a>
        </video>
        {!started && <button className="film-play" onClick={() => void start()} aria-label="Play Snap product film"><Play size={25} fill="currentColor" /><span>Play the film <small>0:25</small></span></button>}
      </div>
      <div className="film-meta"><span>{error ? "Video unavailable. You can retry or download the film." : "1080p · Screenshot-based product film · Starts muted"}</span><a href="/media/snap-promo.mp4" download="Snap-product-film.mp4"><ArrowDownToLine size={15} /> Download film</a></div>
    </section>
  );
}
