import { SelectRow } from "./PanelControls";
import { WandSparkles } from "lucide-react";
import { useRef } from "react";
import type { EditorConfig, Layer, LayerAnimationKey, Keyframe } from "../../../lib/types";
import { animatedLayer } from "../../../lib/layerAnimation";

export default function CameraAnimation({config,time,duration,onChange}:{config:EditorConfig;time:number;duration:number;onChange:(config:EditorConfig)=>void}) {
  const camera=config.cameraOverlay;
  const layer:Layer={id:"camera-animation",type:"shape",shape:"rectangle",color:"transparent",strokeWidth:0,start:0,end:duration,x:camera.x,y:camera.y,w:camera.width,h:camera.width,opacity:camera.opacity,rotation:camera.rotation??0,animation:camera.animation};
  const clipboard=useRef<LayerAnimationKey[]|null>(null);
  const locked=config.lockedTracks?.includes("camera") ?? false;
  const update=(patch:Partial<Layer>)=>layer && !locked && onChange({...config,cameraOverlay:{...camera,animation:patch.animation}});
  const keyTime=Math.max(0,Math.min((layer?.end??0)-(layer?.start??0),time-(layer?.start??0)));
  const pose=layer?animatedLayer(layer,time):null;
  const key=layer?.animation?.find(k=>Math.abs(k.time-keyTime)<1/60);
  const setKey=(patch:Partial<LayerAnimationKey>)=>{
    if(!layer || !pose)return;
    const next={time:keyTime,x:pose.x,y:pose.y,scale:pose.w/Math.max(.001,layer.w),opacity:pose.opacity??1,rotation:pose.rotation??0,easing:"ease-in-out" as Keyframe["easing"],...key,...patch};
    update({animation:[...(layer.animation??[]).filter(k=>Math.abs(k.time-keyTime)>=1/60),next].sort((a,b)=>a.time-b.time)});
  };
  return <section className="ss-section webcam-animation-tools"><h3 className="ss-section-heading"><WandSparkles size={16}/>Webcam animation</h3>
    {layer && pose && <fieldset disabled={locked}><legend>Animation at {keyTime.toFixed(3)}s</legend><p>Times are relative to this object. Move the playhead to add another pose.</p>
      {([ ["x","Position X",pose.x,0,1,.01],["y","Position Y",pose.y,0,1,.01],["scale","Scale",pose.w/Math.max(.001,layer.w),.05,10,.05],["opacity","Opacity",pose.opacity??1,0,1,.05],["rotation","Rotation",pose.rotation??0,-360,360,1] ] as const).map(([field,label,value,min,max,step])=><label key={field}>{label}<input aria-label={`Animation ${label}`} type="number" min={min} max={max} step={step} value={Number(value.toFixed(3))} onChange={e=>{const value=Number(e.target.value);if(Number.isFinite(value))setKey({[field]:Math.max(min,Math.min(max,value))});}}/></label>)}
      <SelectRow label="Easing" value={key?.easing??"ease-in-out"} options={["linear","ease-in","ease-out","ease-in-out","sine","smoother"]} onChange={easing=>setKey({easing:easing as Keyframe["easing"]})}/>
      <div className="editor-tool-row"><button className="ss-drawer-action-btn" onClick={()=>setKey({})}>{key?"Update pose":"Add pose"}</button><button className="ss-drawer-action-btn" disabled={!key} onClick={()=>update({animation:layer.animation?.filter(k=>k!==key)})}>Remove pose</button><button className="ss-drawer-action-btn" onClick={()=>{clipboard.current=layer.animation?.map(k=>({...k}))??[];}}>Copy animation</button><button className="ss-drawer-action-btn" onClick={()=>{if(clipboard.current)update({animation:clipboard.current.filter(k=>k.time<=layer.end-layer.start).map(k=>({...k}))});}}>Paste animation</button></div>
      <small>{layer.animation?.length??0} poses</small>
    </fieldset>}
  </section>;
}
