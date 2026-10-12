import { useEffect, useState } from "react";
import { Check, Image as ImageIcon, ImagePlus } from "lucide-react";
import { assetSrc, preloadImageAsset } from "../../../lib/canvasDraw";
import { getWallpaperPreset, WALLPAPER_PRESETS } from "../../../lib/wallpapers";

const STORAGE_KEY = "snap.backgroundImages.v1";
const pathKey = (path: string) => path.replace(/\\/g, "/").toLowerCase();
const imageName = (path: string) => path.split(/[\\/]/).pop() || "Custom background";

function ImageCard({ path, thumbnail, name, active, onSelect }: { path:string; thumbnail:string; name:string; active:boolean; onSelect:(path:string)=>void }) {
  const [failed,setFailed] = useState(false);
  useEffect(()=>setFailed(false),[thumbnail]);
  return <button type="button" className={`ss-wallpaper-card wallpaper-image-card ${active ? "active" : ""}`} title={failed ? `${name} · Image unavailable` : name} aria-label={`Use background ${name}`} aria-pressed={active} onPointerEnter={()=>preloadImageAsset(getWallpaperPreset(path)?.previewUrl ?? path)} onClick={()=>onSelect(path)}>
    {failed ? <ImageIcon className="wallpaper-image-unavailable" size={22}/> : <img src={assetSrc(thumbnail)} alt="" draggable={false} loading="lazy" decoding="async" onError={()=>setFailed(true)}/>}
    {active && <span className="wallpaper-image-selected" aria-hidden="true"><Check size={12}/></span>}
  </button>;
}

/** Imported backgrounds remain available when switching presets or reopening the panel. */
export default function BackgroundImages({ value, active, onImport, onSelect }: { value:string; active:boolean; onImport:()=>Promise<void>; onSelect:(path:string)=>void }) {
  const [imported,setImported] = useState<string[]>(()=>{
    try {
      const saved:unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
      if (!Array.isArray(saved)) return [];
      return saved.filter((path,index):path is string=>typeof path === "string" && !!path.trim() && !getWallpaperPreset(path) && saved.findIndex(other=>typeof other === "string" && pathKey(other) === pathKey(path)) === index);
    } catch { return []; }
  });
  const current = active && value && !getWallpaperPreset(value) ? value : null;
  useEffect(()=>{
    if(current)setImported(previous=>previous.some(path=>pathKey(path)===pathKey(current)) ? previous : [current,...previous]);
  },[current]);
  useEffect(()=>{
    try { localStorage.setItem(STORAGE_KEY,JSON.stringify(imported)); } catch { /* Current image still works when storage is unavailable. */ }
  },[imported]);
  const custom = current && !imported.some(path=>pathKey(path)===pathKey(current)) ? [current,...imported] : imported;
  return <div className="ss-wallpaper-grid image-grid">
    <button type="button" className="ss-wallpaper-card custom-image-card" onClick={()=>void onImport()} title="Add your own image"><ImagePlus size={22}/><span>Add image</span></button>
    {custom.map(path=><ImageCard key={pathKey(path)} path={path} thumbnail={path} name={imageName(path)} active={active && pathKey(value)===pathKey(path)} onSelect={onSelect}/>)}
    {WALLPAPER_PRESETS.map(preset=><ImageCard key={preset.id} path={preset.id} thumbnail={preset.thumbnailUrl} name={preset.name} active={active && getWallpaperPreset(value)?.id===preset.id} onSelect={onSelect}/>)}
  </div>;
}
