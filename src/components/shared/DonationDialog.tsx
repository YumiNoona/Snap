import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Copy, Heart, ShieldCheck, X } from "lucide-react";
import { useModalFocus } from "../Editor/hooks/useModalFocus";

const UPI_ID = "rushikeshingale2001@okicici";

interface Props {
  afterExport?: boolean;
  onClose: () => void;
}

/** An optional thank-you, never a payment gate or part of the export job. */
export default function DonationDialog({ afterExport = false, onClose }: Props) {
  const titleId = useId();
  const modalRef = useModalFocus(true);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState("");
  const copyTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(copyTimer.current), []);

  const copyUpiId = async () => {
    setCopyError("");
    try {
      try {
        await navigator.clipboard.writeText(UPI_ID);
      } catch {
        const previous = document.activeElement as HTMLElement | null;
        const fallback = document.createElement("textarea");
        fallback.value = UPI_ID;
        fallback.style.position = "fixed";
        fallback.style.opacity = "0";
        (modalRef.current ?? document.body).appendChild(fallback);
        try {
          fallback.select();
          if (!document.execCommand("copy")) throw new Error("Clipboard unavailable");
        } finally {
          fallback.remove();
          if (previous?.isConnected) previous.focus();
        }
      }
      setCopied(true);
      clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
      setCopyError("Couldn't copy the UPI ID. You can scan the QR code instead.");
    }
  };

  return createPortal(
    <div className="donate-modal-backdrop" role="presentation" onPointerDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section
        ref={modalRef}
        className="donate-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={(event) => {
          // Don't pass playback, Tab, or Escape through to the editor/export dialog.
          event.stopPropagation();
          if (event.key === "Escape") { event.preventDefault(); onClose(); }
        }}
      >
        <div className="donate-modal-header">
          <span className="donate-modal-mark"><Heart size={18} fill="currentColor" aria-hidden="true" /></span>
          <div>
            <h2 id={titleId}>{afterExport ? "Your video is saved" : "Support Snap"}</h2>
            <p>{afterExport ? "Thanks for creating with Snap." : "Help keep Snap independent and improving."}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close donation panel"><X size={17} /></button>
        </div>
        <div className="donate-modal-body">
          <div className="donate-qr-frame"><img src="/donate.jpeg" alt="UPI QR code for supporting Snap" /></div>
          <div className="donate-copy">
            <span className="mobile-eyebrow">Scan with any UPI app</span>
            <h3>Enjoying Snap?</h3>
            <p>Snap is free to use. If it helped you make something, an optional donation supports continued development.</p>
            <button type="button" className="donate-upi-copy" onClick={() => void copyUpiId()} aria-label={copied ? "UPI ID copied" : "Copy UPI ID"}>
              <span><small>UPI ID</small><strong>{UPI_ID}</strong></span>
              {copied ? <Check size={16} /> : <Copy size={16} />}
            </button>
            {copyError && <p className="donate-copy-error" role="alert">{copyError}</p>}
            <div className="donate-trust-note"><ShieldCheck size={14} /><span>Payments happen in your UPI app. Snap never sees payment details.</span></div>
          </div>
        </div>
        <footer className="donate-modal-footer">
          <span>{afterExport ? "Your export is ready. Donating is entirely optional." : "Thank you for supporting independent development."}</span>
          <button type="button" onClick={onClose}>Not now</button>
        </footer>
      </section>
    </div>,
    document.body,
  );
}
