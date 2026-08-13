import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Copy, Heart, ShieldCheck, X } from "lucide-react";

const UPI_ID = "rushikeshingale2001@okicici";

interface Props {
  compact?: boolean;
}

export default function DonateButton({ compact = false }: Props) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [open]);

  const copyUpiId = async () => {
    try {
      await navigator.clipboard.writeText(UPI_ID);
    } catch {
      const fallback = document.createElement("textarea");
      fallback.value = UPI_ID;
      fallback.style.position = "fixed";
      fallback.style.opacity = "0";
      document.body.appendChild(fallback);
      fallback.select();
      document.execCommand("copy");
      fallback.remove();
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };

  return (
    <>
      <button
        type="button"
        className={`snap-donate-button ${compact ? "compact" : ""}`}
        onClick={() => setOpen(true)}
        title="Support Snap development"
        aria-label="Donate to support Snap development"
      >
        <Heart size={15} aria-hidden="true" />
        {!compact && <span>Donate</span>}
      </button>

      {open && createPortal(
        <div className="donate-modal-backdrop" role="presentation" onPointerDown={() => setOpen(false)}>
          <section className="donate-modal" role="dialog" aria-modal="true" aria-labelledby="donate-title" onPointerDown={(event) => event.stopPropagation()}>
            <div className="donate-modal-header">
              <span className="donate-modal-mark"><Heart size={18} fill="currentColor" /></span>
              <div><h2 id="donate-title">Support Snap</h2><p>Help keep Snap independent and improving.</p></div>
              <button onClick={() => setOpen(false)} aria-label="Close donation panel"><X size={17} /></button>
            </div>

            <div className="donate-modal-body">
              <div className="donate-qr-frame"><img src="/donate.jpeg" alt="UPI QR code for supporting Snap" /></div>
              <div className="donate-copy">
                <span className="mobile-eyebrow">Scan with any UPI app</span>
                <h3>Enjoying Snap?</h3>
                <p>Your support funds continued work on recording reliability, Auto Zoom, export quality, and new editor tools.</p>
                <button className="donate-upi-copy" onClick={() => void copyUpiId()}>
                  <span><small>UPI ID</small><strong>{UPI_ID}</strong></span>
                  {copied ? <Check size={16} /> : <Copy size={16} />}
                </button>
                <div className="donate-trust-note"><ShieldCheck size={14} /><span>Payments happen securely in your UPI app. Snap never sees payment details.</span></div>
              </div>
            </div>
          </section>
        </div>,
        document.body,
      )}
    </>
  );
}
