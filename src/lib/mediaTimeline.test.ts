import {describe,it,expect} from "vitest";
import {projectMediaLayers,splitMediaLayer,mediaLayerName} from "./mediaTimeline";
import {animatedLayer} from "./layerAnimation";
import {createProject,migrateProject} from "./project";
import type {VideoLayer} from "./types";
const layer:VideoLayer={id:"overlay",type:"video",path:"C:\\media\\intro.mp4",start:3,end:8,timeSpace:"sequence",sourceOffset:2,sourceDuration:12,x:.25,y:.2,w:.5,h:.5};
describe("independent media timeline",()=>{
 it("uses sequence time across repeated, reordered, sped footage and gaps",()=>{
   for(const source of [0,2,40,100]){
     const projected=projectMediaLayers([layer],source,4)[0];
     expect(source-projected.start).toBe(1);
     expect(source>=projected.start&&source<projected.end).toBe(true);
     const inactive=projectMediaLayers([layer],source,9)[0];
     expect(source>=inactive.start&&source<inactive.end).toBe(false);
   }
   expect(layer.start).toBe(3);
 });
 it("preserves the source clock for existing annotations",()=>{
   const legacy={...layer,timeSpace:undefined};
   expect(projectMediaLayers([legacy],40,4)[0]).toBe(legacy);
 });
 it("splits frame accurately and keeps source offsets and animation continuous",()=>{
   const animated={...layer,animation:[{time:0,x:0,y:0,scale:1,opacity:1,rotation:0,easing:"linear" as const},{time:5,x:1,y:0,scale:1,opacity:1,rotation:0,easing:"linear" as const}]};
   const [left,right]=splitMediaLayer(animated,5.01,30) as VideoLayer[];
   expect(left.end).toBe(5);expect(right.start).toBe(5);expect(right.sourceOffset).toBe(4);
   expect(animatedLayer(right,5).x).toBeCloseTo(animatedLayer(animated,5).x);
   expect(right.id).not.toBe(layer.id);
   expect(splitMediaLayer(layer,layer.start,30)).toEqual([layer]);
 });
 it("retains independent placement and offsets through project save and reload",()=>{
   const project=createProject("source.mp4","source.json");project.editor.layers=[layer];
   expect(migrateProject(JSON.parse(JSON.stringify(project))).editor.layers).toEqual([layer]);
   expect(mediaLayerName(layer)).toBe("intro.mp4");
 });
});
