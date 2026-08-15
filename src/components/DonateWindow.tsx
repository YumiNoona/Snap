import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Check, Copy, Heart, ShieldCheck, X } from "lucide-react";
import "./ModuleWindows.css";

const UPI_ID = "rushikeshingale2001@okicici";
export default function DonateWindow() {
  const [copied, setCopied] = useState(false);
  useEffect(() => { void invoke("window_ready"); }, []);
  const copy = async () => { await navigator.clipboard.writeText(UPI_ID); setCopied(true); setTimeout(() => setCopied(false), 1500); };
  return <div className="module-window donate-window">
    <header className="module-titlebar" data-tauri-drag-region><span className="module-mark donate"><Heart size={17} /></span><div data-tauri-drag-region><strong data-tauri-drag-region>Support Snap</strong><small data-tauri-drag-region>Help keep the recorder independent</small></div><button onClick={() => getCurrentWindow().close()}><X size={16} /></button></header>
    <main className="donate-window-body"><div className="donate-window-qr"><img src="/donate.jpeg" alt="UPI payment QR code" /></div><section><span className="module-kicker">Support development</span><h2>Help make Snap better.</h2><p>Your contribution supports reliable recording, smarter Auto Zoom, captioning and export improvements.</p><button className="upi-button" onClick={() => void copy()}><span><small>UPI ID</small><strong>{UPI_ID}</strong></span>{copied ? <Check size={17} /> : <Copy size={17} />}</button><div className="safe-note"><ShieldCheck size={15} /> Snap never receives your payment information.</div></section></main>
  </div>;
}
