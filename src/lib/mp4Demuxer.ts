/** Sample tables for ordinary AVC MP4/MOV files. Other layouts use media seeking. */
export interface Mp4Sample {
  offset: number;
  size: number;
  timestamp: number;
  duration: number;
  key: boolean;
}
export interface Mp4Track {
  config: VideoDecoderConfig;
  samples: Mp4Sample[];
}
interface Box { type: string; start: number; data: number; end: number }

export function mp4BoxHeader(bytes: Uint8Array): { type: string; size: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const shortSize = view.getUint32(0);
  const size = shortSize === 1 ? view.getUint32(8) * 4294967296 + view.getUint32(12) : shortSize;
  if (!Number.isSafeInteger(size)) throw new Error("Unsupported MP4 box size");
  return { type: String.fromCharCode(...bytes.subarray(4, 8)), size };
}

export function parseMp4Track(bytes: Uint8Array, fileSize: number): Mp4Track {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u32 = (offset: number) => view.getUint32(offset);
  const i32 = (offset: number) => view.getInt32(offset);
  const u64 = (offset: number) => {
    const value = u32(offset) * 4294967296 + u32(offset + 4);
    if (!Number.isSafeInteger(value)) throw new Error("Unsupported MP4 offset");
    return value;
  };
  const text = (offset: number) => String.fromCharCode(...bytes.subarray(offset, offset + 4));
  const children = (start: number, end: number): Box[] => {
    const result: Box[] = [];
    for (let offset = start; offset < end;) {
      if (offset + 8 > end) throw new Error("Truncated MP4 box");
      const shortSize = u32(offset), header = shortSize === 1 ? 16 : 8;
      const size = shortSize === 1 ? u64(offset + 8) : shortSize || end - offset;
      if (size < header || offset + size > end) throw new Error("Invalid MP4 box");
      result.push({ type: text(offset + 4), start: offset, data: offset + header, end: offset + size });
      offset += size;
    }
    return result;
  };
  const find = (box: Box, type: string) => children(box.data, box.end).find(item => item.type === type);
  const required = (box: Box, type: string): Box => {
    const value = find(box, type);
    if (!value) throw new Error(`Missing MP4 ${type}`);
    return value;
  };
  const timescale = (box: Box) => u32(box.data + (bytes[box.data] === 1 ? 20 : 12));
  const moov = children(0, bytes.length).find(box => box.type === "moov");
  if (!moov || find(moov, "mvex")) throw new Error("Fragmented MP4 uses media seeking");
  const movieScale = timescale(required(moov, "mvhd"));
  const trak = children(moov.data, moov.end).find(box => {
    if (box.type !== "trak") return false;
    const mdia = required(box, "mdia");
    return text(required(mdia, "hdlr").data + 8) === "vide";
  });
  if (!trak) throw new Error("No MP4 video track");
  const tkhd = required(trak, "tkhd"), matrix = tkhd.data + (bytes[tkhd.data] === 1 ? 52 : 40);
  // HTML media handles rotation and anamorphic pixels. Keep that fallback
  // instead of silently changing the orientation of imported phone footage.
  const identity = [65536, 0, 0, 0, 65536, 0, 0, 0, 1073741824];
  if (identity.some((value, index) => i32(matrix + index * 4) !== value)) throw new Error("Transformed MP4 uses media seeking");
  const mdia = required(trak, "mdia"), scale = timescale(required(mdia, "mdhd"));
  if (!scale || !movieScale) throw new Error("Invalid MP4 timescale");
  const stbl = required(required(mdia, "minf"), "stbl");
  const stsd = required(stbl, "stsd");
  if (u32(stsd.data + 4) !== 1) throw new Error("Multiple MP4 sample descriptions");
  const entry = children(stsd.data + 8, stsd.end)[0];
  if (!entry || !["avc1", "avc3"].includes(entry.type)) throw new Error("Non-AVC MP4 uses media seeking");
  const extensions = children(entry.data + 78, entry.end);
  const avc = extensions.find(box => box.type === "avcC"), pasp = extensions.find(box => box.type === "pasp");
  if (!avc || avc.end - avc.data < 7 || (pasp && u32(pasp.data) !== u32(pasp.data + 4))) throw new Error("Unsupported AVC configuration");
  const description = bytes.slice(avc.data, avc.end);
  const codec = `avc1.${[description[1], description[2], description[3]].map(value => value.toString(16).padStart(2, "0")).join("")}`;

  let shift = 0;
  const edts = find(trak, "edts"), elst = edts && find(edts, "elst");
  if (elst) {
    const wide = bytes[elst.data] === 1, count = u32(elst.data + 4);
    let mediaEdit = false;
    if (count > 2) throw new Error("Complex MP4 edits use media seeking");
    for (let index = 0, pos = elst.data + 8; index < count; index++, pos += wide ? 20 : 12) {
      const length = wide ? u64(pos) : u32(pos);
      const mediaTime = wide ? view.getInt32(pos + 8) * 4294967296 + u32(pos + 12) : i32(pos + 4);
      const ratePos = pos + (wide ? 16 : 8);
      if (view.getInt16(ratePos) !== 1 || view.getInt16(ratePos + 2) !== 0 || mediaEdit) throw new Error("Complex MP4 edits use media seeking");
      if (mediaTime === -1) shift += length / movieScale;
      else { shift -= mediaTime / scale; mediaEdit = true; }
    }
  }

  const stsz = required(stbl, "stsz"), fixedSize = u32(stsz.data + 4), count = u32(stsz.data + 8);
  if (!count || count > 2_000_000 || (!fixedSize && stsz.data + 12 + count * 4 > stsz.end)) throw new Error("Invalid MP4 sample count");
  const samples: Mp4Sample[] = Array.from({ length: count }, (_, index) => ({
    offset: 0, size: fixedSize || u32(stsz.data + 12 + index * 4), timestamp: 0, duration: 0, key: false,
  }));
  const expand = (box: Box, apply: (sample: Mp4Sample, value: number) => void, signed = false) => {
    const entries = u32(box.data + 4);
    if (box.data + 8 + entries * 8 > box.end) throw new Error("Truncated MP4 timing table");
    let sampleIndex = 0;
    for (let index = 0; index < entries; index++) {
      const at = box.data + 8 + index * 8, length = u32(at), value = signed ? i32(at + 4) : u32(at + 4);
      if (sampleIndex + length > count) throw new Error("Invalid MP4 timing table");
      for (let repeat = 0; repeat < length; repeat++) apply(samples[sampleIndex++], value);
    }
    if (sampleIndex !== count) throw new Error("Incomplete MP4 timing table");
  };
  let dts = 0;
  expand(required(stbl, "stts"), (sample, delta) => {
    sample.timestamp = dts; sample.duration = Math.round(delta / scale * 1_000_000); dts += delta;
  });
  const ctts = find(stbl, "ctts");
  if (ctts) expand(ctts, (sample, offset) => { sample.timestamp += offset; }, bytes[ctts.data] === 1);
  for (const sample of samples) sample.timestamp = Math.round((sample.timestamp / scale + shift) * 1_000_000);

  const stsc = required(stbl, "stsc"), stco = find(stbl, "stco") ?? required(stbl, "co64");
  const chunkCount = u32(stco.data + 4), mapCount = u32(stsc.data + 4), wide = stco.type === "co64";
  if (!mapCount || stsc.data + 8 + mapCount * 12 > stsc.end || stco.data + 8 + chunkCount * (wide ? 8 : 4) > stco.end || u32(stsc.data + 8) !== 1) throw new Error("Invalid MP4 chunk table");
  let sampleIndex = 0, mapIndex = 0;
  for (let chunk = 1; chunk <= chunkCount; chunk++) {
    while (mapIndex + 1 < mapCount && u32(stsc.data + 8 + (mapIndex + 1) * 12) <= chunk) mapIndex++;
    const map = stsc.data + 8 + mapIndex * 12, chunkSamples = u32(map + 4);
    if (u32(map + 8) !== 1 || sampleIndex + chunkSamples > count) throw new Error("Invalid MP4 chunk mapping");
    const at = stco.data + 8 + (chunk - 1) * (wide ? 8 : 4);
    let offset = wide ? u64(at) : u32(at);
    for (let index = 0; index < chunkSamples; index++) {
      const sample = samples[sampleIndex++]; sample.offset = offset; offset += sample.size;
      if (!sample.size || offset > fileSize) throw new Error("Invalid MP4 sample offset");
    }
  }
  if (sampleIndex !== count) throw new Error("Incomplete MP4 chunk mapping");
  const stss = find(stbl, "stss");
  if (stss) {
    const keys = u32(stss.data + 4);
    if (stss.data + 8 + keys * 4 > stss.end) throw new Error("Truncated MP4 keyframe table");
    for (let index = 0; index < keys; index++) {
      const sample = samples[u32(stss.data + 8 + index * 4) - 1];
      if (!sample) throw new Error("Invalid MP4 keyframe");
      sample.key = true;
    }
  } else for (const sample of samples) sample.key = true;
  if (!samples[0].key) throw new Error("MP4 starts without a keyframe");
  return { config: { codec, codedWidth: view.getUint16(entry.data + 24), codedHeight: view.getUint16(entry.data + 26), description }, samples };
}
