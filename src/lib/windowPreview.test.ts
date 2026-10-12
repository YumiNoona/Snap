import {expect,it} from "vitest";
import {hasWindowPreviewContent} from "./windowPreview";
it("rejects black and transparent thumbnails but keeps a dark terminal with text",()=>{
 const pixels=new Uint8ClampedArray(32*18*4);
 expect(hasWindowPreviewContent(pixels)).toBe(false);
 for(let i=3;i<pixels.length;i+=4)pixels[i]=255;
 expect(hasWindowPreviewContent(pixels)).toBe(false);
 for(let i=0;i<8*4;i+=4){pixels[i]=200;pixels[i+1]=200;pixels[i+2]=200;}
 expect(hasWindowPreviewContent(pixels)).toBe(true);
 expect(hasWindowPreviewContent([])).toBe(false);
});
