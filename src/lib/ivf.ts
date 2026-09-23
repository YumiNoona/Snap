export type IvfCodec = "VP80" | "VP90";

function writeFourCc(target: Uint8Array, offset: number, value: string) {
  for (let index = 0; index < 4; index += 1) target[offset + index] = value.charCodeAt(index);
}

export function createIvfHeader(
  width: number,
  height: number,
  fps: number,
  frameCount: number,
  codec: IvfCodec,
): Uint8Array {
  const bytes = new Uint8Array(32);
  const view = new DataView(bytes.buffer);
  writeFourCc(bytes, 0, "DKIF");
  view.setUint16(4, 0, true);
  view.setUint16(6, 32, true);
  writeFourCc(bytes, 8, codec);
  view.setUint16(12, width, true);
  view.setUint16(14, height, true);
  view.setUint32(16, fps, true);
  view.setUint32(20, 1, true);
  view.setUint32(24, frameCount, true);
  view.setUint32(28, 0, true);
  return bytes;
}

export function wrapIvfFrame(payload: Uint8Array, frameIndex: number): Uint8Array {
  const bytes = new Uint8Array(12 + payload.byteLength);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, payload.byteLength, true);
  view.setBigUint64(4, BigInt(frameIndex), true);
  bytes.set(payload, 12);
  return bytes;
}
