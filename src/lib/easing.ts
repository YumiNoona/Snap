export function motionEase(t:number,curve:string="ease-in-out",bezier?:[number,number,number,number]):number {
  t=Math.max(0,Math.min(1,t));
  if(curve==="hold")return t===1?1:0;
  if(curve==="custom"&&bezier?.every(Number.isFinite)){
    const [x1,y1,x2,y2]=bezier,cubic=(u:number,a:number,b:number)=>3*(1-u)**2*u*a+3*(1-u)*u*u*b+u**3;
    let lo=0,hi=1,u=t;for(let i=0;i<24;i++){const x=cubic(u,Math.max(0,Math.min(1,x1)),Math.max(0,Math.min(1,x2)));if(Math.abs(x-t)<1e-7)break;if(x<t)lo=u;else hi=u;u=(lo+hi)/2;}return cubic(u,y1,y2);
  }
  if(curve==="linear")return t;
  if(curve==="ease-in")return t*t*t;
  if(curve==="ease-out")return 1-(1-t)**3;
  if(curve==="sine")return (1-Math.cos(Math.PI*t))/2;
  if(curve==="smoother")return t*t*t*(t*(6*t-15)+10);
  return t<.5?2*t*t:1-(-2*t+2)**2/2;
}
