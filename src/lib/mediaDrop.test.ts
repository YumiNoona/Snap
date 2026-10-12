import { expect, it } from "vitest";
import { mediaDropPosition } from "./mediaDrop";
it("uses source boundaries in source view and sequence boundaries in edited view", () => {
  const clips = [{ id:"a",start:10,end:14,speed:2 }, { id:"b",start:20,end:24 }];
  expect(mediaDropPosition(201,{left:0,width:600},6,clips,false,true,30)).toEqual({display:2,sequence:2});
  expect(mediaDropPosition(139,{left:0,width:240},24,clips,true,true,30)).toEqual({display:14,sequence:2});
  expect(mediaDropPosition(-100,{left:0,width:600},6,clips,false,true,30).sequence).toBe(0);
});
