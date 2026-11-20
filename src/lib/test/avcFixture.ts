export const word = (...values: number[]) => {
  const bytes = new Uint8Array(values.length * 4), view = new DataView(bytes.buffer);
  values.forEach((value, index) => view.setUint32(index * 4, value)); return bytes;
};
export const join = (...parts: Uint8Array[]) => {
  const bytes = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0; for (const part of parts) { bytes.set(part, offset); offset += part.length; } return bytes;
};
export const box = (type: string, ...parts: Uint8Array[]) => {
  const body = join(...parts); return join(word(8 + body.length), new TextEncoder().encode(type), body);
};

export function avcFixture({ count = 12, offsets = Array(count).fill(0) as number[], edit = 0, rotated = false, fragmented = false } = {}) {
  const ftyp = box("ftyp", new TextEncoder().encode("isom"), word(0));
  const payload = Uint8Array.from({ length: count * 5 }, (_, i) => Math.floor(i / 5));
  const mdat = box("mdat", payload);
  const track = new Uint8Array(84), trackView = new DataView(track.buffer);
  [65536, 0, 0, 0, 65536, 0, 0, 0, 1073741824].forEach((value, i) => trackView.setInt32(40 + i * 4, value));
  if (rotated) trackView.setInt32(40, 0);
  const visual = new Uint8Array(78), visualView = new DataView(visual.buffer);
  visualView.setUint16(24, 640); visualView.setUint16(26, 360);
  const moov = box("moov",
    box("mvhd", word(0, 0, 0, 30)),
    ...(fragmented ? [box("mvex")] : []),
    box("trak", box("tkhd", track),
      box("edts", box("elst", word(0, 1, count, edit, 65536))),
      box("mdia", box("mdhd", word(0, 0, 0, 30)), box("hdlr", word(0, 0), new TextEncoder().encode("vide")),
        box("minf", box("stbl",
          box("stsd", word(0, 1), box("avc1", visual, box("avcC", Uint8Array.of(1, 100, 0, 42, 255, 225, 0)))),
          box("stsz", word(0, 5, count)), box("stts", word(0, 1, count, 1)),
          box("ctts", word(0, count, ...offsets.flatMap(offset => [1, offset]))),
          box("stsc", word(0, 1, 1, count, 1)), box("stco", word(0, 1, ftyp.length + 8)),
          box("stss", word(0, 2, 1, Math.floor(count / 2) + 1)),
        )),
      ),
    ),
  );
  return { bytes: join(ftyp, mdat, moov), moov, payloadOffset: ftyp.length + 8 };
}
