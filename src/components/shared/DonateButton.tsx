import { useState } from "react";
import { Heart } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import DonationDialog from "./DonationDialog";

interface Props {
  compact?: boolean;
}

export default function DonateButton({ compact = false }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        className={`snap-donate-button ${compact ? "compact" : ""}`}
        onClick={() => { void invoke("open_donate_window").catch(() => setOpen(true)); }}
        title="Support Snap development"
        aria-label="Donate to support Snap development"
      >
        <Heart size={15} aria-hidden="true" />
        {!compact && <span>Donate</span>}
      </button>

      {open && <DonationDialog onClose={() => setOpen(false)} />}
    </>
  );
}
