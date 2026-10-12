export interface TimedKey { time: number }

export function copyKeys<T extends TimedKey>(keys: T[], times: number[]): T[] {
  return structuredClone(keys.filter(key => times.some(time => Math.abs(time - key.time) < 1e-6)).sort((a,b)=>a.time-b.time));
}

export function retimeKeys<T extends TimedKey>(keys: T[], times: number[], delta: number, maximum: number, fps: number): T[] {
  const selected = copyKeys(keys, times);
  if (!selected.length || !Number.isFinite(delta) || !Number.isFinite(maximum) || maximum < selected[selected.length-1].time) return keys;
  const rate = Number.isFinite(fps) && fps >= 1 ? Math.min(240, fps) : 30;
  const shift = Math.max(-selected[0].time, Math.min(maximum-selected[selected.length-1].time, Math.round(delta*rate)/rate));
  const moved = selected.map(key=>({...key,time:Math.min(Math.floor(maximum*rate)/rate, Math.max(0, Math.round((key.time+shift)*rate)/rate))}));
  return [...keys.filter(key=>!times.some(time=>Math.abs(time-key.time)<1e-6)&&!moved.some(other=>Math.abs(other.time-key.time)<1/rate/2)),...moved].sort((a,b)=>a.time-b.time);
}

export function pasteKeys<T extends TimedKey>(keys: T[], copied: T[], anchor: number, maximum: number, fps: number): T[] {
  if (!copied.length || !Number.isFinite(anchor) || !Number.isFinite(maximum) || maximum < 0) return keys;
  const rate = Number.isFinite(fps) && fps >= 1 ? Math.min(240, fps) : 30;
  const first = Math.min(...copied.map(key=>key.time));
  const pasted = structuredClone(copied).map(key=>({...key,time:Math.round((anchor+key.time-first)*rate)/rate})).filter(key=>key.time>=0&&key.time<=maximum);
  const unique = new Map(pasted.map(key=>[key.time,key]));
  if (keys.length + unique.size > 1000) return keys;
  return [...keys.filter(key=>![...unique.keys()].some(time=>Math.abs(key.time-time)<1/rate/2)),...unique.values()].sort((a,b)=>a.time-b.time);
}

/** Duplicate into free frame slots, keeping every existing key intact. */
export function duplicateKeys<T extends TimedKey>(keys: T[], times: number[], maximum: number, fps: number): T[] {
  const copied = copyKeys(keys, times);
  if (!copied.length || keys.length + copied.length > 1000 || !Number.isFinite(maximum)) return keys;
  const rate = Number.isFinite(fps) && fps >= 1 ? Math.min(240, fps) : 30;
  const span = copied[copied.length - 1].time - copied[0].time;
  const candidates = [copied[copied.length - 1].time + 1 / rate, copied[0].time - span - 1 / rate];
  for (const anchor of candidates) {
    const added = copied.map(key => ({ ...key, time: Math.round((anchor + key.time - copied[0].time) * rate) / rate }));
    if (added.some(key => key.time < 0 || key.time > maximum || keys.some(other => Math.abs(other.time - key.time) < .5 / rate))) continue;
    return [...keys, ...structuredClone(added)].sort((a, b) => a.time - b.time);
  }
  return keys;
}
