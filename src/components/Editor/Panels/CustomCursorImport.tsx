import { useState } from "react";
import { Plus, X, Check } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { assetSrc } from "../../../lib/canvasDraw";
import { userError } from "../../../lib/userError";
import type { CursorPackInfo } from "../../../lib/types";

export default function CustomCursorImport({ onImported }: { onImported: (pack: CursorPackInfo) => void }) {
  const [source, setSource] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const choose = async () => {
    if (busy) return;
    setBusy(true); setError("");
    try {
      const path = await open({ title: "Add a custom cursor", multiple: false, filters: [{ name: "PNG cursor", extensions: ["png"] }] });
      if (typeof path === "string") {
        setSource(path);
        setName((path.split(/[\\/]/).pop() ?? "Cursor").replace(/\.png$/i, "").slice(0, 48));
      }
    } catch (e) { setError(userError(e)); }
    finally { setBusy(false); }
  };
  const save = async () => {
    if (busy || !name.trim()) return;
    setBusy(true); setError("");
    try {
      const pack = await invoke<CursorPackInfo>("import_custom_cursor", { sourcePath: source, name: name.trim() });
      onImported(pack); setSource(""); setName("");
    } catch (e) { setError(userError(e)); }
    finally { setBusy(false); }
  };
  return <div className="custom-cursor-import">
    {!source ? <button type="button" className="ss-drawer-action-btn" disabled={busy} onClick={() => void choose()}><Plus size={15} />Add custom cursor</button> :
      <form className="custom-cursor-form" onSubmit={e => { e.preventDefault(); void save(); }}>
        <div className="custom-cursor-heading"><img src={assetSrc(source)} alt="Cursor preview" /><label htmlFor="custom-cursor-name">Cursor name</label><button type="button" aria-label="Cancel cursor import" disabled={busy} onClick={() => { setSource(""); setError(""); }}><X size={15} /></button></div>
        <input id="custom-cursor-name" autoFocus value={name} maxLength={48} disabled={busy} onChange={e => setName(e.target.value)} placeholder="Name your cursor" />
        <button type="submit" className="ss-drawer-action-btn" disabled={busy || !name.trim()}><Check size={15} />{busy ? "Saving…" : "Save cursor"}</button>
      </form>}
    {error && <p className="cursor-pack-error" role="alert">{error}</p>}
  </div>;
}
