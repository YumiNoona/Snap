export function timelineHeightBounds(visibleTrackCount: number): { minimum: number; maximum: number } {
  const rows = Math.max(1, Math.floor(visibleTrackCount));
  const natural = 52 + 24 + 28 + 64 + Math.max(0, rows - 1) * 36;
  const minimum = Math.min(280, Math.max(220, natural));
  return { minimum, maximum: Math.max(320, Math.min(620, natural)) };
}

/** Keep floating tools inside the viewport, even when the timeline is very tall. */
export function timelineInspectorLayout(timelineTop:number,viewportHeight:number):{maxHeight:number;position?:"absolute";top?:number;bottom?:"auto"} {
  const height=Math.max(180,Number.isFinite(viewportHeight)?viewportHeight:800);
  const top=Number.isFinite(timelineTop)?timelineTop:height-280;
  return top<240?{position:"absolute",top:16-top,bottom:"auto",maxHeight:height-32}:{maxHeight:Math.max(140,top-26)};
}
