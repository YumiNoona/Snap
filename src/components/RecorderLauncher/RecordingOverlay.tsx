import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import "./FloatingToolbar.css";

interface OverlayRegion {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface OverlayState {
  style: "off" | "red" | "dashed";
  region: OverlayRegion | null;
  paused?: boolean;
}

export default function RecordingOverlay() {
  const [style, setStyle] = useState<"off" | "red" | "dashed">("off");
  const [region, setRegion] = useState<OverlayRegion | null>(null);
  const [paused, setPaused] = useState(false);

  // Transparent window — clear the app-level dark body background.
  useEffect(() => {
    document.body.style.background = "transparent";
    const html = document.documentElement;
    html.style.background = "transparent";
    return () => {
      document.body.style.background = "";
      html.style.background = "";
    };
  }, []);

  useEffect(() => {
    const un = listen<OverlayState>("overlay-state", (e) => {
      setStyle(e.payload.style);
      setRegion(e.payload.region);
      setPaused(!!e.payload.paused);
    });
    return () => {
      un.then((fn) => fn());
    };
  }, []);

  if (style === "off") return null;

  const box =
    region && region.w > 0 && region.h > 0
      ? { left: region.x, top: region.y, width: region.w, height: region.h }
      : { left: 0, top: 0, right: 0, bottom: 0 };

  const cls = paused
    ? "rec-border green"
    : style === "red"
      ? "rec-border red"
      : "rec-border dashed";

  return (
    <div className="overlay-window-root">
      <div className={cls} style={box} />
    </div>
  );
}