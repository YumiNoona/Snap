import { useEffect, useState } from "react";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { Image, Film, Music2, RefreshCw } from "lucide-react";

/** Library cards use cached stills: no bank of decoding/playing videos and no
 * blank video tags when the browser cannot decode an imported container. */
export default function MediaPreview({ path, kind, name }: { path: string; kind: string; name: string }) {
  const [source, setSource] = useState("");
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setSource(""); setFailed(false);
    if (kind === "audio") return;
    if (kind === "image") { setSource(convertFileSrc(path)); return; }
    void invoke<string>("editor_cached_media", { path, kind: "poster" }).then(file => {
      if (!cancelled) setSource(convertFileSrc(file));
    }).catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [path, kind, attempt]);
  if (kind === "audio") return <div className="media-audio-art"><Music2 size={23} /><span>{Array.from({ length: 13 }, (_, bar) => <i key={bar} style={{ height: `${20 + Math.abs(Math.sin(bar * 1.7)) * 75}%` }} />)}</span></div>;
  return <>
    {source && !failed ? <img key={source} src={source} alt={`${name} preview`} draggable={false} onError={() => setFailed(true)} /> :
      <div className={`media-preview-placeholder ${failed ? "failed" : "loading"}`}>
        {kind === "image" ? <Image size={26} /> : <Film size={26} />}
        {failed && <button type="button" aria-label={`Retry ${name} preview`} onClick={() => setAttempt(n => n + 1)}><RefreshCw size={13} />Retry preview</button>}
      </div>}
    <span className="media-preview-kind" aria-hidden="true">{kind === "video" ? <Film size={13} /> : <Image size={13} />}</span>
  </>;
}
