import Slider from "../shared/Slider";
import { SelectRow, CheckRow } from "./Panels/PanelControls";
import "./Panels/Panels.css";
import { useEffect, useMemo, useRef, useState } from "react";
import { AudioLines, Ratio, Palette, X, Trash2, RefreshCw } from "lucide-react";
import { loadInputLog, type LoadedInputLog } from "../../lib/inputLog";
import { getGradientPreset, gradientToCss } from "../../lib/wallpapers";
import { userError } from "../../lib/userError";
import type {
  AudioTrack,
  CaptionTrack,
  EditorConfig,
  Keyframe,
} from "../../lib/types";
import {
  applyCursorEdits,
  createRecipe,
  formatLayout,
  LAYOUT_FORMATS,
  formatCaptionTracks,
  reaimZoomsAtClicks,
  type BrandRecipe,
} from "../../lib/editorFinishing";
import { useModalFocus } from "./hooks/useModalFocus";
import "./FinishingStudio.css";

interface Props {
  config: EditorConfig;
  inputLogPath: string;
  captions: CaptionTrack[];
  keyframes: Keyframe[];
  tracks: AudioTrack[];
  voiceStatus: string;
  bypass: boolean;
  onBypass: (value: boolean) => void;
  onChange: (
    config: EditorConfig,
    keyframes?: Keyframe[],
    captions?: CaptionTrack[],
  ) => void;
  onTracks: (tracks: AudioTrack[]) => void;
  onClose: () => void;
}
function presetBackground(appearance: Partial<EditorConfig>) {
  const gradient = appearance.bgType === "wallpaper" && appearance.wallpaperUrl ? getGradientPreset(appearance.wallpaperUrl) : undefined;
  return gradient ? gradientToCss(gradient) : appearance.backgroundColor ?? "var(--bg-hover)";
}
const RECIPE_KEY = "snap.brandRecipes.v1";
export default function FinishingStudio(p: Props) {
  const [tab, setTab] = useState("voice");
  const [message, setMessage] = useState("");
  const [log, setLog] = useState<LoadedInputLog | null>(null);
  useEffect(() => {
    let cancelled = false;
    void loadInputLog(p.inputLogPath)
      .then((value) => {
        if (!cancelled) setLog(value);
      })
      .catch((error) => {
        if (!cancelled) setMessage(userError(error));
      });
    return () => {
      cancelled = true;
    };
  }, [p.inputLogPath]);
  const [name, setName] = useState("My preset"),
    [recipes, setRecipes] = useState<BrandRecipe[]>(() => {
      try {
        const value = JSON.parse(localStorage.getItem(RECIPE_KEY) ?? "[]");
        return Array.isArray(value)
          ? value
              .filter((r) => r && typeof r.name === "string" && r.appearance)
              .slice(0, 50)
          : [];
      } catch {
        return [];
      }
    });
  const [applyAppearance, setApplyAppearance] = useState(true),
    [applyCaptions, setApplyCaptions] = useState(true),
    [applyAudio, setApplyAudio] = useState(false),
    [applyCursor, setApplyCursor] = useState(true),
    [applyLayout, setApplyLayout] = useState(false);
  const starterRecipes = useMemo<BrandRecipe[]>(() => [
    { id: "starter-clean", name: "Clean", appearance: { bgType: "color", backgroundColor: "#edf0f4", padding: 48, borderRadius: 16, shadow: {enabled:true,blur:32,spread:0,color:"rgba(0,0,0,0.18)",offsetX:0,offsetY:8} } },
    { id: "starter-studio", name: "Studio", appearance: { bgType: "color", backgroundColor: "#202531", padding: 64, borderRadius: 20, shadow: {enabled:true,blur:48,spread:8,color:"rgba(0,0,0,0.5)",offsetX:0,offsetY:16} } },
    { id: "starter-edge", name: "Edge to edge", appearance: { padding: 0, borderRadius: 0, inset: 0, shadow: {enabled:false,blur:0,spread:0,color:"rgba(0,0,0,0)",offsetX:0,offsetY:0} } },
  ], []);
  const ref = useModalFocus(true);
  const [position, setPosition] = useState({x:0,y:0});
  const drag = useRef<{x:number;y:number;left:number;top:number;offsetX:number;offsetY:number;width:number;height:number}|null>(null);
  useEffect(() => {
    const constrain = () => {
      const rect = ref.current?.getBoundingClientRect();
      if (!rect) return;
      setPosition(previous => ({x:previous.x + Math.max(12-rect.left,Math.min(0,window.innerWidth-12-rect.right)),y:previous.y + Math.max(12-rect.top,Math.min(0,window.innerHeight-12-rect.bottom))}));
    };
    window.addEventListener("resize",constrain);
    return () => window.removeEventListener("resize",constrain);
  }, [ref]);
  const crop = p.config.crop ?? {x:0,y:0,w:1,h:1};
  const cropEdge = (edge: "left" | "right" | "top" | "bottom", percent: number) => {
    const next = {...crop};
    const value = percent / 100;
    if(edge === "left") { const right = crop.x+crop.w; next.x = Math.min(value,right-.05); next.w = right-next.x; }
    if(edge === "right") next.w = Math.max(.05,1-value-crop.x);
    if(edge === "top") { const bottom = crop.y+crop.h; next.y = Math.min(value,bottom-.05); next.h = bottom-next.y; }
    if(edge === "bottom") next.h = Math.max(.05,1-value-crop.y);
    p.onChange({...p.config,crop:next});
  };
  const store = (next: BrandRecipe[]) => {
    try {
      localStorage.setItem(RECIPE_KEY, JSON.stringify(next));
      setRecipes(next);
      setMessage("Presets saved on this computer.");
    } catch {
      setMessage("Recipe storage is full or unavailable; nothing was saved.");
    }
  };
  return (
    <div
      className="ss-command-backdrop finishing-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) p.onClose();
      }}
    >
      <section
        ref={ref}
        tabIndex={-1}
        className="finishing-studio editor-glass-surface"
        style={{transform:`translate(${position.x}px,${position.y}px)`}}
        role="dialog"
        aria-modal="true"
        aria-label="Refine video"
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            p.onClose();
          }
        }}
      >
        <header className="refine-drag-handle"
          onPointerDown={event=>{
            if(event.button!==0 || (event.target as HTMLElement).closest("button"))return;
            const rect=ref.current!.getBoundingClientRect();
            drag.current={x:event.clientX,y:event.clientY,left:rect.left,top:rect.top,offsetX:position.x,offsetY:position.y,width:rect.width,height:rect.height};
            event.currentTarget.setPointerCapture(event.pointerId);event.preventDefault();
          }}
          onPointerMove={event=>{const start=drag.current;if(!start)return;
            const left=Math.max(12,Math.min(window.innerWidth-start.width-12,start.left+event.clientX-start.x));
            const top=Math.max(12,Math.min(window.innerHeight-start.height-12,start.top+event.clientY-start.y));
            setPosition({x:start.offsetX+left-start.left,y:start.offsetY+top-start.top});
          }}
          onPointerUp={event=>{drag.current=null;if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId);}}
          onPointerCancel={()=>{drag.current=null;}}
          onLostPointerCapture={()=>{drag.current=null;}}
        >
          <div>
            <h2>Refine</h2>
          </div>
          <button className="finishing-icon-button" aria-label="Close Refine" onClick={p.onClose}>
            <X size={16} />
          </button>
        </header>
        <nav className="toggle-segmented" role="tablist" aria-label="Refine tools">
          {["voice", "formats", "recipes"].map((t) => (
            <button
              key={t}
              className={`seg-btn ${tab === t ? "active" : ""}`}
              tabIndex={tab === t ? 0 : -1}
              onKeyDown={event=>{if(!["ArrowLeft","ArrowRight","Home","End"].includes(event.key))return;event.preventDefault();const tabs=Array.from(event.currentTarget.parentElement!.querySelectorAll<HTMLButtonElement>("[role=tab]"));const index=tabs.indexOf(event.currentTarget);const next=event.key==="Home"?0:event.key==="End"?tabs.length-1:(index+(event.key==="ArrowRight"?1:-1)+tabs.length)%tabs.length;tabs[next].click();tabs[next].focus();}}
              role="tab" id={`refine-tab-${t}`} aria-controls="refine-panel" aria-selected={tab === t}
              onClick={() => {
                setTab(t);
                setMessage("");

              }}
            >
              {({ voice: <AudioLines size={16} />, formats: <Ratio size={16} />, recipes: <Palette size={16} /> })[t]}
              {
                {
                  voice: "Voice",
                  formats: "Layouts",
                  recipes: "Presets",
                }[t]
              }
            </button>
          ))}
        </nav>
        <div className="finishing-body" id="refine-panel" role="tabpanel" aria-labelledby={`refine-tab-${tab}`}>
          {tab === "voice" && (
            <>
              {p.tracks.map((t) => {
                const settings = t.voicePolish ?? {
                  enabled: false,
                  strength: 0.5,
                  hum: "off" as const,
                  roomTail: false,
                  loudness: true,
                };
                const update = (patch: Partial<typeof settings>) =>
                  p.onTracks(
                    p.tracks.map((track) =>
                      track.id === t.id
                        ? { ...track, voicePolish: { ...settings, ...patch } }
                        : track,
                    ),
                  );
                return (
                  <fieldset
                    key={t.id}
                    disabled={p.config.lockedTracks?.includes(t.id)}
                  >
                    <legend>{t.label}</legend>
                    <CheckRow label="Voice polish" checked={settings.enabled} onChange={enabled=>update({enabled})}/>
                    <Slider showValueTooltip={false} label="Strength" value={settings.strength*100} min={0} max={100} step={5} unit="%" onChange={strength=>update({strength:strength/100})}/>
                    <SelectRow label="Hum filter" value={settings.hum} options={["off","50","60"]} optionLabels={{off:"Off","50":"50 Hz","60":"60 Hz"}} onChange={hum=>update({hum:hum as typeof settings.hum})}/>
                    <CheckRow label="Reduce room tails" checked={settings.roomTail} onChange={roomTail=>update({roomTail})}/>
                    <CheckRow label="Level voice" checked={settings.loudness} onChange={loudness=>update({loudness})}/>
                  </fieldset>
                );
              })}
              {!p.tracks.length && <p>Add a narration audio track first.</p>}
              <div className="toggle-segmented finishing-comparison" role="group" aria-label="Compare voice">
                <button className={`seg-btn ${p.bypass?"active":""}`} aria-pressed={p.bypass} disabled={!p.voiceStatus.startsWith("Voice polish ready")} onClick={()=>p.onBypass(true)}>Original</button>
                <button className={`seg-btn ${!p.bypass?"active":""}`} aria-pressed={!p.bypass} disabled={!p.voiceStatus.startsWith("Voice polish ready")} onClick={()=>p.onBypass(false)}>Polished</button>
              </div>
              {p.voiceStatus && <p role="status">{p.voiceStatus}</p>}
            </>
          )}
          {tab === "formats" && (
            <>
              <div className="refine-card-grid">
                {LAYOUT_FORMATS.map(({id:format,name:label,width,height,description}) => (
                  <button
                    key={format} className="refine-format-card" aria-label={`Set ${label} layout`} aria-pressed={!!p.config.aspectRatio && Math.abs(p.config.aspectRatio.width/p.config.aspectRatio.height-width/height)<.001}
                    onClick={() => {
                      const config = formatLayout(p.config, format);
                      p.onChange(config, p.keyframes, formatCaptionTracks(p.captions, format));
                    }}
                  >
                    <span className="refine-format-art" aria-hidden="true"><span style={{aspectRatio:`${width}/${height}`,width:width>=height?64:Math.round(54*width/height),height:width>=height?Math.round(64*height/width):54}}><i/><i/><i/></span></span>
                    <strong>{label}</strong><span>{width}:{height} · {description}</span>
                  </button>
                ))}
              </div>
              <fieldset className="refine-framing"><legend>Framing</legend>
                <Slider showValueTooltip={false} label="Left" value={crop.x*100} min={0} max={Math.max(0,(crop.x+crop.w-.05)*100)} step={1} unit="%" onChange={value=>cropEdge("left",value)}/>
                <Slider showValueTooltip={false} label="Right" value={(1-crop.x-crop.w)*100} min={0} max={(.95-crop.x)*100} step={1} unit="%" onChange={value=>cropEdge("right",value)}/>
                <Slider showValueTooltip={false} label="Top" value={crop.y*100} min={0} max={Math.max(0,(crop.y+crop.h-.05)*100)} step={1} unit="%" onChange={value=>cropEdge("top",value)}/>
                <Slider showValueTooltip={false} label="Bottom" value={(1-crop.y-crop.h)*100} min={0} max={(.95-crop.y)*100} step={1} unit="%" onChange={value=>cropEdge("bottom",value)}/>
                <button disabled={!p.config.crop} onClick={()=>p.onChange({...p.config,crop:null})}>Reset crop</button>
              </fieldset>
              <fieldset className="refine-guides"><legend>Guides & focus</legend>
              <SelectRow label="Safe guides" value={p.config.safeArea??"off"} options={["off","vertical","square"]} onChange={safeArea=>p.onChange({...p.config,safeArea:safeArea as EditorConfig["safeArea"]})}/>
              <button
                disabled={
                  !log?.region ||
                  !log.clickEvents.length ||
                  p.config.lockedTracks?.includes("zoom")
                }
                onClick={() => {
                  if (!log) return;
                  const repairedLog = applyCursorEdits(
                    log,
                    p.config.cursorEdits ?? [],
                  );
                  const config = {
                    ...p.config,
                    videoClips:
                      p.config.videoClips?.map((clip) =>
                        clip.effects
                          ? {
                              ...clip,
                              effects: {
                                ...clip.effects,
                                keyframes: reaimZoomsAtClicks(
                                  clip.effects.keyframes,
                                  repairedLog,
                                  p.config.crop,
                                ),
                              },
                            }
                          : clip,
                      ) ?? null,
                  };
                  p.onChange(
                    config,
                    reaimZoomsAtClicks(p.keyframes, repairedLog, p.config.crop),
                  );
                  setMessage(
                    "Zoom targets re-aimed at nearby recorded clicks. Review edge framing in preview.",
                  );
                }}
              >
                Reframe around clicks
              </button>
              </fieldset>
            </>
          )}
          {tab === "recipes" && (
            <>
              <h3>Save current style</h3>
              <div className="refine-save-row"><label>
                Name
                <input
                  value={name}
                  maxLength={80}
                  onChange={(e) => setName(e.target.value)}
                />
              </label>
              <button
                disabled={!name.trim() || recipes.length >= 50}
                onClick={() =>
                  store([
                    ...recipes,
                    createRecipe(name.trim(), p.config, p.captions, p.tracks),
                  ])
                }
              >
                Save preset
              </button></div>
              <fieldset className="refine-apply-options"><legend>Include when applying</legend>
                <CheckRow label="Canvas" checked={applyAppearance} onChange={setApplyAppearance}/>
                <CheckRow label="Cursor & motion" checked={applyCursor} onChange={setApplyCursor}/>
                <CheckRow label="Layout & camera" checked={applyLayout} onChange={setApplyLayout}/>
                <CheckRow label="Caption style" checked={applyCaptions} onChange={setApplyCaptions}/>
                <CheckRow label="Audio mix & voice" checked={applyAudio} onChange={setApplyAudio}/>
              </fieldset>
              <h3>Style library <span className="refine-count">{recipes.length} saved</span></h3>
              <div className="refine-card-grid refine-preset-grid">
              {[...starterRecipes,...recipes].map((r) => (
                <div className="refine-preset-card" key={r.id}>
                  <div className="refine-preset-art" style={{background:presetBackground(r.appearance)}} aria-hidden="true"><span style={{borderRadius:Math.min(12,r.appearance.borderRadius??14),width:r.appearance.padding===0?"100%":"72%",height:r.appearance.padding===0?"100%":"64%",boxShadow:r.appearance.shadow?.enabled?"0 6px 14px #0005":"none"}}><i/><i/><i/></span></div>
                  <strong>{r.name}</strong>
                  <span className="refine-card-detail">{r.id.startsWith("starter-")?"Starter style":`${r.appearance.padding??0}px padding · ${r.appearance.borderRadius??0}px corners`}</span>
                  <div className="refine-preset-actions">
                  <button disabled={!applyAppearance&&!applyCursor&&!applyLayout&&!applyCaptions&&!applyAudio}
                    onClick={() => {
                      const { audio, cursorStyle, cursorMovement, zoomMovement, motionBlur, aspectRatio, cameraOverlay, exportDefaults, ...appearance } = r.appearance;
                      const defined = (values: Partial<EditorConfig>) => Object.fromEntries(Object.entries(values).filter(([,v])=>v!==undefined));
                      p.onChange(
                        {
                          ...p.config,
                          videoClips:
                            applyCaptions && r.captionStyle
                              ? (p.config.videoClips?.map((c) =>
                                  c.effects
                                    ? {
                                        ...c,
                                        effects: {
                                          ...c.effects,
                                          captions: c.effects.captions.map(
                                            (t) => ({
                                              ...t,
                                              style: structuredClone(
                                                r.captionStyle!,
                                              ),
                                            }),
                                          ),
                                        },
                                      }
                                    : c,
                                ) ?? null)
                              : p.config.videoClips,
                          ...(applyAppearance
                            ? structuredClone(appearance)
                            : {}),
                          ...(applyCursor ? structuredClone(defined({cursorStyle,cursorMovement,zoomMovement,motionBlur})) : {}),
                          ...(applyLayout ? structuredClone(defined({aspectRatio,cameraOverlay,exportDefaults})) : {}),
                          ...(applyAudio && audio
                            ? { audio: structuredClone(audio) }
                            : {}),
                        },
                        undefined,
                        applyCaptions && r.captionStyle
                          ? p.captions.map((t) => ({
                              ...t,
                              style: structuredClone(r.captionStyle!),
                            }))
                          : undefined,
                      );
                      if (applyAudio && r.voicePolish)
                        p.onTracks(
                          p.tracks.map((t) =>
                            t.kind === "microphone"
                              ? {
                                  ...t,
                                  voicePolish: structuredClone(r.voicePolish),
                                }
                              : t,
                          ),
                        );
                      setMessage(
                        `Applied ${r.name}. Undo restores the previous edit.`,
                      );
                    }}
                  >
                    Apply
                  </button>
                  {!r.id.startsWith("starter-") && <><button className="finishing-icon-button" aria-label={`Update ${r.name} from current edit`} onClick={()=>store(recipes.map(v=>v.id===r.id?{...createRecipe(r.name,p.config,p.captions,p.tracks),id:r.id}:v))}><RefreshCw size={16}/></button>
                  <button
                    aria-label={`Delete ${r.name} preset`} className="finishing-icon-button" onClick={() => store(recipes.filter((v) => v.id !== r.id))}
                  >
                    <Trash2 size={16}/>
                  </button></>}
                  </div>
                </div>
              ))}</div>
            </>
          )}
        </div>
        {message && <footer role="status">{message}</footer>}
      </section>
    </div>
  );
}
