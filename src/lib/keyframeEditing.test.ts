import { describe, it, expect } from "vitest";
import { copyKeys, retimeKeys, pasteKeys, duplicateKeys } from "./keyframeEditing";
const keys = [{ time: 1, value: "first" }, { time: 2, value: "second" }, { time: 4, value: "third" }];
describe("keyframe editing", () => {
  it("moves a selection as a group with frame snapping and boundary clamping", () => {
    expect(retimeKeys(keys, [1,2], -10, 5, 30)).toEqual([{time:0,value:"first"},{time:1,value:"second"},{time:4,value:"third"}]);
    expect(retimeKeys(keys, [1,2], .051, 5, 30)[0].time).toBeCloseTo(1 + 2/30);
    expect(retimeKeys(keys, [1,2], 20, 5.01, 30).every(key => key.time <= 5.01)).toBe(true);
  });
  it("copies full values and pastes relative to the playhead, replacing collisions", () => {
    const copied = copyKeys(keys, [1,2]);
    copied[0].value = "copy";
    expect(keys[0].value).toBe("first");
    expect(pasteKeys(keys, copied, 4, 5, 30)).toEqual([...keys.slice(0,2),{time:4,value:"copy"},{time:5,value:"second"}]);
    expect(pasteKeys(keys, copied, 5, 5, 30)).toHaveLength(4);
  });
  it("rejects invalid edits without removing existing keys", () => {
    expect(retimeKeys(keys,[1],NaN,5,30)).toBe(keys);
    expect(pasteKeys(keys,keys,NaN,5,30)).toBe(keys);
    const full=Array.from({length:1000},(_,time)=>({time}));
    expect(pasteKeys(full,[{time:0}],1001,2000,30)).toBe(full);
  });
});

it("duplicates without replacing nearby keys or changing the original selection", () => {
  const result = duplicateKeys(keys,[1,2],10,30);
  expect(result).toHaveLength(5);
  for(const key of keys) expect(result).toContainEqual(key);
  expect(result.filter(key=>!keys.includes(key)).map(key=>key.time)).toEqual([61/30,91/30]);
  expect(duplicateKeys([{time:0},{time:1}],[0,1],1,30)).toEqual([{time:0},{time:1}]);
});
