export function motionEase(t:number,curve:string="ease-in-out"):number {
  t=Math.max(0,Math.min(1,t));
  if(curve==="linear")return t;
  if(curve==="ease-in")return t*t*t;
  if(curve==="ease-out")return 1-(1-t)**3;
  if(curve==="sine")return (1-Math.cos(Math.PI*t))/2;
  if(curve==="smoother")return t*t*t*(t*(6*t-15)+10);
  return t<.5?2*t*t:1-(-2*t+2)**2/2;
}
