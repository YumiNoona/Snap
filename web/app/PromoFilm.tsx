"use client";

import { useEffect, useRef, useState } from "react";
import { Play } from "lucide-react";

export default function PromoFilm() {
  const video = useRef<HTMLVideoElement>(null);
  const [started, setStarted] = useState(false);
  const [error, setError] = useState(false);
  const [autoplayAllowed, setAutoplayAllowed] = useState(false);
  useEffect(() => {
    const player = video.current;
    if (!player) return;
    let disposed = false;
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => {
      const allowed = !preference.matches;
      setAutoplayAllowed(allowed);
      if (!allowed) { player.pause(); return; }
      // Muted inline playback is allowed by normal browser autoplay policies.
      // Still keep native controls and a play fallback for restrictive settings.
      player.muted = true;
      void player.play().catch(() => { if (!disposed) setStarted(false); });
    };
    update(); preference.addEventListener("change", update);
    return () => { disposed = true; preference.removeEventListener("change", update); };
  }, []);
  const start = async () => {
    if (!video.current) return;
    setError(false);
    try { await video.current.play(); } catch { setStarted(false); setError(true); }
  };
  return (
    <section className="product-film shell" id="film" aria-labelledby="film-title">
      <div className="film-heading">
        <div><span className="section-kicker">A little tour</span><h2 id="film-title">Meet Snap.<br /><span>In 30 seconds.</span></h2></div>
      </div>
      <div className={`film-player${started ? " is-started" : ""}`}>
        <video ref={video} poster="/media/snap-promo-poster.webp" preload="auto" autoPlay={autoplayAllowed} loop playsInline controls muted aria-label="Snap product film, 30 seconds" onPlay={() => { setStarted(true); setError(false); }} onError={() => { setError(true); setStarted(false); }}>
          <source src="/media/snap-promo.mp4" type="video/mp4" />
          <track kind="captions" src="/media/snap-promo.vtt" srcLang="en" label="English feature titles" />
          Your browser does not support this video.
        </video>
        {!started && <button className="film-play" onClick={() => void start()} aria-label="Play Snap product film"><Play size={25} fill="currentColor" /><span>Play the film <small>0:30</small></span></button>}
      </div>
      {error && <p className="film-error" role="status">Video unavailable. Please try playing it again.</p>}
    </section>
  );
}
