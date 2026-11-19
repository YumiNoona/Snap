import { useEffect, useMemo, useRef, useState } from "react";
import { Play, Volume2, VolumeX } from "lucide-react";
import { mediaSrc } from "../../lib/mediaSource";
import {
  clipCaptions,
  formatClipTime,
  type ClipAnalysis,
  type ClipCandidate,
  type ClipRatio,
  type ClipCaptionOptions,
} from "../../lib/autoClips";
import {
  drawSplitFrame,
  fitRect,
  normalizedRect,
  type FrameRect,
  type SplitLayout,
  type VideoFit,
} from "../../lib/videoFraming";
import { drawCaptionTrack } from "../../lib/canvasDraw";
import type { AudioTrack } from "../../lib/types";

interface Props {
  path: string;
  audioTracks?: AudioTrack[];
  analysis: ClipAnalysis;
  clip: ClipCandidate;
  ratio: ClipRatio;
  split?: SplitLayout;
  captions: boolean;
  captionOptions: ClipCaptionOptions;
  editRegion: "camera" | "content" | null;
  content: FrameRect;
  fit: VideoFit;
  onRegion: (region: "camera" | "content", rect: FrameRect) => void;
}
export default function AutoClipPreview(p: Props) {
  const video = useRef<HTMLVideoElement>(null),
    canvas = useRef<HTMLCanvasElement>(null);
  const [playError, setPlayError] = useState("");
  const [previewMuted,setPreviewMuted]=useState(false);
  const audio = useRef<Array<HTMLAudioElement | null>>([]);
  const sidecars = (p.audioTracks ?? []).filter(
    (t) => t.path !== p.path,
  );
  const syncAudio = () => {
    const v = video.current;
    if (!v) return;
    audio.current.forEach((a) => {
      if (!a) return;
      if (Math.abs(a.currentTime - v.currentTime) > 0.15)
        a.currentTime = v.currentTime;
      a.playbackRate = v.playbackRate;
      if (v.paused || v.seeking) a.pause();
      else if (a.paused)
        void a
          .play()
          .catch(() =>
            setPlayError(
              "Source audio could not play. Re-import the recording to check its audio tracks.",
            ),
          );
    });
  };
  const drag = useRef<{
    x: number;
    y: number;
    rect: FrameRect;
    mode: "draw" | "move" | "se" | "nw";
    region: "camera" | "content";
  } | null>(null);
  const tracks = useMemo(
    () =>
      p.captions
        ? clipCaptions(p.analysis, p.clip, p.ratio, [], {
            ...p.captionOptions,
            y:
              p.captionOptions.y ??
              (p.split ? Math.max(0.12, p.split.fraction - 0.035) : 0.8),
          })
        : [],
    [p.analysis, p.clip, p.ratio, p.captions, p.captionOptions, p.split],
  );
  useEffect(() => {
    const media = video.current;
    if (media) {
      media.pause();
      media.currentTime = p.clip.start;
    }
  }, [p.clip.id, p.clip.start, p.path]);
  useEffect(() => {
    let frame = 0,
      last = -1;
    const draw = () => {
      const v = video.current,
        c = canvas.current,
        ctx = c?.getContext("2d");
      if (
        v &&
        c &&
        ctx &&
        v.readyState >= 2 &&
        !v.seeking &&
        v.currentTime !== last
      ) {
        if (v.currentTime >= p.clip.end) {
          v.pause();
          v.currentTime = p.clip.start;
        }
        const target = { x: 0, y: 0, w: c.width, h: c.height };
        ctx.fillStyle = "#08090c";
        ctx.fillRect(0, 0, c.width, c.height);
        if (p.split)
          drawSplitFrame(ctx, v, v.videoWidth, v.videoHeight, target, p.split);
        else {
          const r = normalizedRect(p.content);
          const f = fitRect(
            {
              x: r.x * v.videoWidth,
              y: r.y * v.videoHeight,
              w: r.w * v.videoWidth,
              h: r.h * v.videoHeight,
            },
            target,
            p.fit,
          );
          ctx.drawImage(
            v,
            f.source.x,
            f.source.y,
            f.source.w,
            f.source.h,
            f.target.x,
            f.target.y,
            f.target.w,
            f.target.h,
          );
        }
        tracks.forEach((t) =>
          drawCaptionTrack(ctx, t, v.currentTime * 1000, target),
        );
        last = v.currentTime;
      }
      frame = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(frame);
  }, [p.clip, p.split, p.content, p.fit, tracks]);
  useEffect(() => {
    const media = video.current;
    const sounds = audio.current.filter((a): a is HTMLAudioElement => !!a);
    return () => {
      sounds.forEach((a) => {
        a.pause();
        a.removeAttribute("src");
        a.load();
      });
      if (media) {
        media.pause();
        media.removeAttribute("src");
        media.load();
      }
    };
  }, []);
  const point = (e: React.PointerEvent<HTMLDivElement>) => {
    const b = e.currentTarget.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (e.clientX - b.left) / b.width)),
      y: Math.max(0, Math.min(1, (e.clientY - b.top) / b.height)),
    };
  };
  const region = p.editRegion;
  const rect = region === "camera" ? p.split?.camera : p.content;
  const [rw, rh] = p.ratio.split(":").map(Number);
  return (
    <div className="ac-previews">
      <section>
        <h3>
          Landscape version <span>Original source</span>
        </h3>
        <div
          className={`ac-source-frame ${region ? "ac-editing" : ""}`}
          style={{ aspectRatio: `${p.analysis.width}/${p.analysis.height}` }}
          onPointerDown={(e) => {
            if (!region) return;
            e.preventDefault();
            const q = point(e),
              target = e.target as HTMLElement;
            const handle = target.dataset.cropHandle;
            const mode =
              handle === "nw" || handle === "se"
                ? handle
                : target.closest(".ac-crop-box")
                  ? "move"
                  : "draw";
            drag.current = {
              ...q,
              rect: rect ?? { x: q.x, y: q.y, w: 0.1, h: 0.1 },
              mode,
              region,
            };
            e.currentTarget.setPointerCapture(e.pointerId);
          }}
          onPointerMove={(e) => {
            const d = drag.current;
            if (!d) return;
            const q = point(e),
              dx = q.x - d.x,
              dy = q.y - d.y;
            let r = { ...d.rect };
            if (d.mode === "draw")
              r = {
                x: Math.min(d.x, q.x),
                y: Math.min(d.y, q.y),
                w: Math.max(0.04, Math.abs(q.x - d.x)),
                h: Math.max(0.04, Math.abs(q.y - d.y)),
              };
            else if (d.mode === "move") {
              r.x = Math.max(0, Math.min(1 - r.w, r.x + dx));
              r.y = Math.max(0, Math.min(1 - r.h, r.y + dy));
            } else if (d.mode === "se") {
              r.w = Math.max(0.04, q.x - r.x);
              r.h = Math.max(0.04, q.y - r.y);
            } else {
              const right = r.x + r.w,
                bottom = r.y + r.h;
              r.x = Math.min(right - 0.04, q.x);
              r.y = Math.min(bottom - 0.04, q.y);
              r.w = right - r.x;
              r.h = bottom - r.y;
            }
            p.onRegion(d.region, normalizedRect(r));
          }}
          onPointerUp={(e) => {
            drag.current = null;
            if (e.currentTarget.hasPointerCapture(e.pointerId))
              e.currentTarget.releasePointerCapture(e.pointerId);
          }}
          onPointerCancel={() => {
            drag.current = null;
          }}
        >
          <video
            ref={video}
            src={mediaSrc(p.path)}
            controls={!region}
            playsInline
            preload="metadata"
            muted={sidecars.length > 0 || previewMuted}
            onPause={syncAudio}
            onSeeking={syncAudio}
            onSeeked={syncAudio}
            onTimeUpdate={syncAudio}
            onRateChange={syncAudio}
            onLoadedMetadata={() => {
              if (video.current) video.current.currentTime = p.clip.start;
            }}
            onPlay={() => {
              if (
                video.current &&
                (video.current.currentTime < p.clip.start ||
                  video.current.currentTime >= p.clip.end)
              )
                video.current.currentTime = p.clip.start;
              syncAudio();
            }}
          />
          {sidecars.map((track, i) => (
            <audio
              key={track.id + track.path}
              ref={(el) => {
                audio.current[i] = el;
                  if (el) el.volume = track.muted?0:Math.max(0, Math.min(1, track.volume));
              }}
              src={mediaSrc(track.path)}
                muted={previewMuted}
              preload="metadata"
            />
          ))}
          {region && rect && (
            <div
              className={`ac-crop-box ${region}`}
              tabIndex={0}
              role="group"
              aria-label={`${region} crop; drag to move, arrow keys to adjust`}
              style={{
                left: `${rect.x * 100}%`,
                top: `${rect.y * 100}%`,
                width: `${rect.w * 100}%`,
                height: `${rect.h * 100}%`,
              }}
              onKeyDown={(e) => {
                if (
                  !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(
                    e.key,
                  )
                )
                  return;
                e.preventDefault();
                const step = e.shiftKey ? 0.05 : 0.01;
                p.onRegion(
                  region,
                  normalizedRect({
                    ...rect,
                    x: Math.min(
                      1 - rect.w,
                      Math.max(
                        0,
                        rect.x +
                          (e.key === "ArrowRight"
                            ? step
                            : e.key === "ArrowLeft"
                              ? -step
                              : 0),
                      ),
                    ),
                    y: Math.min(
                      1 - rect.h,
                      Math.max(
                        0,
                        rect.y +
                          (e.key === "ArrowDown"
                            ? step
                            : e.key === "ArrowUp"
                              ? -step
                              : 0),
                      ),
                    ),
                  }),
                );
              }}
            >
              <span>{region === "camera" ? "Camera" : "Gameplay"}</span>
              <button
                data-crop-handle="nw"
                aria-label={`Resize ${region} top left`}
              />
              <button
                data-crop-handle="se"
                aria-label={`Resize ${region} bottom right`}
              />
            </div>
          )}
        </div>
        <div className="ac-preview-controls">
          {sidecars.length>0&&<button aria-label={previewMuted?"Unmute source audio":"Mute source audio"} onClick={()=>setPreviewMuted(v=>!v)}>{previewMuted?<VolumeX size={14}/>:<Volume2 size={14}/>}</button>}
          <button
            onClick={() => {
              if (video.current) {
                video.current.currentTime = p.clip.start;
                void video.current
                  .play()
                  .catch(() =>
                    setPlayError(
                      "The source could not play. Try re-importing it.",
                    ),
                  );
              }
            }}
          >
            <Play size={14} />
            Play selected clip
          </button>
          <span>
            {formatClipTime(p.clip.start)} – {formatClipTime(p.clip.end)}
          </span>
        </div>
        {playError && <p role="alert">{playError}</p>}
        {region && (
          <p className="ac-help">
            Drag a box to select{" "}
            {region === "camera" ? "the facecam" : "the gameplay"}. Drag inside
            to move it, or drag a corner to resize.
          </p>
        )}
      </section>
      <section className="ac-portrait">
        <h3>
          {p.ratio === "9:16" ? "Portrait version" : `${p.ratio} version`}
          <span>Final framing & captions</span>
        </h3>
        <canvas
          ref={canvas}
          width={360}
          height={Math.round((360 * rh) / rw)}
          aria-label={`${p.ratio} clip preview`}
          style={{ aspectRatio: `${rw}/${rh}` }}
        />
      </section>
    </div>
  );
}
