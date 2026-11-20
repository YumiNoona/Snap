import { expect, it } from "vitest";
import { mp4BoxHeader, parseMp4Track } from "./mp4Demuxer";
import { avcFixture, join, word } from "./test/avcFixture";

it("maps byte ranges, AVC setup, B-frame presentation timestamps and edit-list offsets", () => {
  const { moov, bytes, payloadOffset } = avcFixture({ count: 6, offsets: [2, 4, 1, 1, 2, 2], edit: 2 });
  const track = parseMp4Track(moov, bytes.length);
  expect(track.config).toMatchObject({ codec: "avc1.64002a", codedWidth: 640, codedHeight: 360 });
  expect(track.samples.map(sample => sample.offset)).toEqual(Array.from({ length: 6 }, (_, i) => payloadOffset + i * 5));
  expect(track.samples.map(sample => sample.timestamp)).toEqual([0, 100000, 33333, 66667, 133333, 166667]);
  expect(track.samples.filter(sample => sample.key).map(sample => sample.offset)).toEqual([payloadOffset, payloadOffset + 15]);
});
it("rejects transformed, fragmented and truncated media instead of exporting wrong frames", () => {
  for (const options of [{ rotated: true }, { fragmented: true }]) {
    const { bytes, moov } = avcFixture(options);
    expect(() => parseMp4Track(moov, bytes.length)).toThrow();
  }
  const { moov, bytes } = avcFixture();
  expect(() => parseMp4Track(moov.slice(0, -1), bytes.length)).toThrow();
  expect(() => parseMp4Track(moov, 1)).toThrow("offset");
});
it("reads extended box sizes without truncating offsets above 4 GB", () => {
  expect(mp4BoxHeader(join(word(1), new TextEncoder().encode("mdat"), word(2, 123)))).toEqual({ type: "mdat", size: 8589934715 });
});
