import { useEffect, useState } from "react";
import { MousePointer2 } from "lucide-react";
import { loadSystemCursor, type SystemCursorAsset } from "../../../lib/systemCursor";

export default function SystemCursorThumbnail() {
  const [asset, setAsset] = useState<SystemCursorAsset | null>(null);
  useEffect(() => {
    let cancelled = false;
    const refresh = () => { void loadSystemCursor(true).then(image => { if (!cancelled) setAsset(image); }); };
    void loadSystemCursor().then(image => { if (!cancelled) setAsset(image); });
    window.addEventListener("focus", refresh);
    return () => { cancelled = true; window.removeEventListener("focus", refresh); };
  }, []);
  if (!asset) return <MousePointer2 size={16} aria-hidden="true" />;
  return <span className="system-cursor-thumbnail" aria-hidden="true">
    <img src={asset.imageUrl} alt="" draggable={false} />
    {asset.invertUrl && <img className="system-cursor-inverse" src={asset.invertUrl} alt="" draggable={false} />}
  </span>;
}
