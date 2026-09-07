import { ImageResponse } from "next/og";

export const size = { width: 64, height: 64 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    <div style={{ width: "64px", height: "64px", display: "flex", alignItems: "center", justifyContent: "center", background: "#070b14" }}>
      <div style={{ width: "38px", height: "38px", display: "flex", alignItems: "center", justifyContent: "center", position: "relative", borderRadius: "13px", background: "#7c5cff", transform: "rotate(-7deg)" }}>
        <div style={{ width: "27px", height: "27px", display: "flex", alignItems: "center", justifyContent: "center", border: "3px solid #070b14", borderRadius: "9px", background: "#63f5c6", transform: "rotate(7deg)" }}>
          <div style={{ width: "8px", height: "8px", borderRadius: "99px", background: "#070b14" }} />
        </div>
      </div>
    </div>,
    size,
  );
}
