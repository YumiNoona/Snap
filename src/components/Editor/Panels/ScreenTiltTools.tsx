import { CheckRow, SelectRow, Section } from "./PanelControls";
import { Diamond, Trash2, RotateCcw } from "lucide-react";
import type { EditorConfig } from "../../../lib/types";
import { DEFAULT_SCREEN_TILT, resolveScreenTilt, type ScreenTiltPose, type ScreenTiltKey } from "../../../lib/screenTilt";
import Slider from "../../shared/Slider";

const PRESETS = [
  { label: "Left", tiltX: 6, tiltY: -22, scale: .9 },
  { label: "Right", tiltX: 6, tiltY: 22, scale: .9 },
  { label: "Isometric", tiltX: 18, tiltY: -24, scale: .9 },
  { label: "Flat", tiltX: 0, tiltY: 0, scale: 1 },
];
export default function ScreenTiltTools({config,time,onChange}:{config:EditorConfig;time:number;onChange:(config:EditorConfig)=>void}) {
  const effect=config.screenTilt??DEFAULT_SCREEN_TILT;
  const pose=resolveScreenTilt({...effect,enabled:true},time);
  const key=effect.keys.find(k=>Math.abs(k.time-time)<1/60);
  const update=(patch:Partial<typeof effect>)=>onChange({...config,screenTilt:{...effect,...patch}});
  const setKey=(patch:Partial<ScreenTiltPose>={})=>{
    const next:ScreenTiltKey={...pose,time,easing:key?.easing??"ease-in-out",...patch};
    update({enabled:true,keys:[...effect.keys.filter(k=>Math.abs(k.time-time)>=1/60),next].sort((a,b)=>a.time-b.time)});
  };
  const change=(patch:Partial<ScreenTiltPose>)=>effect.keys.length?setKey(patch):update(patch);
  return <>
    <Section title="3D Tilt">
      <CheckRow label="Enable tilt" checked={effect.enabled} onChange={enabled=>update({enabled})}/>
      {effect.enabled && <>
        <div className="ss-subtab-segmented tilt-presets" aria-label="Tilt presets">
          {PRESETS.map(preset=>{
            const active=Math.abs(pose.tiltX-preset.tiltX)<.01&&Math.abs(pose.tiltY-preset.tiltY)<.01&&Math.abs(pose.scale-preset.scale)<.01&&Math.abs(pose.rotation)<.01;
            return <button type="button" className={`subtab-btn ${active?"active":""}`} aria-pressed={active} key={preset.label} onClick={()=>change({tiltX:preset.tiltX,tiltY:preset.tiltY,rotation:0,scale:preset.scale})}>{preset.label}</button>;
          })}
        </div>
        <Slider label="Tilt X" value={pose.tiltX} min={-45} max={45} step={1} unit="°" onChange={tiltX=>change({tiltX})} defaultValue={0} onReset={()=>change({tiltX:0})}/>
        <Slider label="Tilt Y" value={pose.tiltY} min={-45} max={45} step={1} unit="°" onChange={tiltY=>change({tiltY})} defaultValue={0} onReset={()=>change({tiltY:0})}/>
        <Slider label="Rotation" value={pose.rotation} min={-45} max={45} step={1} unit="°" onChange={rotation=>change({rotation})} defaultValue={0} onReset={()=>change({rotation:0})}/>
        <Slider label="Scale" value={pose.scale} min={.5} max={1.3} step={.01} unit="×" onChange={scale=>change({scale})} defaultValue={1} onReset={()=>change({scale:1})}/>
        <Slider label="Perspective" value={pose.perspective} min={1.5} max={6} step={.1} unit="×" onChange={perspective=>change({perspective})} defaultValue={2.5} onReset={()=>change({perspective:2.5})}/>
        <button type="button" className="ss-drawer-action-btn tilt-reset-pose" onClick={()=>change({tiltX:0,tiltY:0,rotation:0,scale:1,perspective:2.5})}><RotateCcw size={14}/>Reset pose</button>
      </>}
    </Section>
    {effect.enabled && <Section title="Animation">
      <div className="field-row tilt-keyframe-row">
        <span className="field-label">Keyframe</span>
        <div className="tilt-keyframe-actions">
        <button type="button" className="ss-drawer-action-btn" aria-label={key?"Update keyframe":"Add keyframe"} title={key?"Update keyframe":"Add keyframe"} onClick={()=>setKey()}><Diamond size={16} fill={key?"currentColor":"none"}/></button>
        <button type="button" className="ss-drawer-action-btn tilt-remove-key" disabled={!key} aria-label="Remove keyframe" title="Remove keyframe at playhead" onClick={()=>update({keys:effect.keys.filter(k=>k!==key)})}><Trash2 size={14}/></button>
        </div>
      </div>
      {key && <SelectRow label="Easing" value={key.easing} options={["linear","ease-in","ease-out","ease-in-out","sine","smoother"]} optionLabels={{linear:"Linear","ease-in":"Ease in","ease-out":"Ease out","ease-in-out":"Smooth",sine:"Sine",smoother:"Gentle"}} onChange={easing=>update({keys:effect.keys.map(k=>k===key?{...k,easing:easing as ScreenTiltKey["easing"]}:k)})}/>}
    </Section>}
  </>;
}
