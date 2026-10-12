import { useEffect, useId, useState, type CSSProperties } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Mic } from "lucide-react";

export function fluidLevel(peak: number) {
  return Number.isFinite(peak) && peak > .003 ? Math.min(1, Math.max(0, (20 * Math.log10(peak) + 50) / 44)) : 0;
}
export default function MicrophoneFluid({ device, enabled }: { device: string; enabled: boolean }) {
  const [level, setLevel] = useState(0);
  const id = useId().replace(/:/g, "");
  useEffect(() => {
    let cancelled = false, timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      if (cancelled) return;
      const active = enabled && device !== "disabled" && document.visibilityState !== "hidden" && document.hasFocus();
      try {
        const peak = await invoke<number>("microphone_preview_level", { micDeviceId: active ? device : "disabled" });
        if (!cancelled) setLevel(previous => active ? Math.max(fluidLevel(peak), previous * .72) : 0);
      } catch { if (!cancelled) setLevel(0); }
      if (!cancelled) timer = setTimeout(tick, 100);
    };
    void tick();
    return () => { cancelled = true; clearTimeout(timer); void invoke("microphone_preview_level", { micDeviceId: "disabled" }).catch(() => {}); };
  }, [device, enabled]);
  return <span className={`setup-field-icon microphone-fluid ${level > .02 ? "active" : ""}`} aria-label={device === "disabled" ? "Microphone off" : "Microphone input level"} style={{ "--mic-level": level } as CSSProperties}>
    <svg className="microphone-fluid-water" viewBox="0 0 40 40" aria-hidden="true"><defs><linearGradient id={id} x2="0" y2="1"><stop stopColor="#c7fff0" stopOpacity=".45"/><stop offset="1" stopColor="#58bda2" stopOpacity=".2"/></linearGradient></defs><g><path fill={`url(#${id})`} d="M-40 4 Q-30 -2 -20 4 T0 4 T20 4 T40 4 T60 4 T80 4 V50 H-40Z"/><path fill="#b9f7e820" d="M-40 7 Q-30 13 -20 7 T0 7 T20 7 T40 7 T60 7 T80 7 V50 H-40Z"/></g></svg>
    <Mic size={18} />
  </span>;
}
