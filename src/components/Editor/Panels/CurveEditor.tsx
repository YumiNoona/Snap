import { useState } from "react";
import { normalizeCurve, sampleCurve } from "../../../lib/colorLut";
import type { ColorGrade, CurvePoint } from "../../../lib/colorGrade";
import { RotateCcw, Minus } from "lucide-react";
export default function CurveEditor({
  value,
  onChange,
}: {
  value: ColorGrade["curves"];
  onChange: (value: ColorGrade["curves"]) => void;
}) {
  const [channel, setChannel] = useState<"master" | "red" | "green" | "blue">(
      "master",
    ),
    [selected, setSelected] = useState(0),
    [draft, setDraft] = useState<CurvePoint[] | null>(null);
  const points = draft ?? normalizeCurve(value?.[channel]),
    color = {
      master: "var(--text-primary)",
      red: "#ef7c7c",
      green: "#68d6a5",
      blue: "#83baff",
    }[channel];
  const commit = (p: CurvePoint[]) => {
    onChange({ ...value, [channel]: normalizeCurve(p) });
    setDraft(null);
  };
  const update = (index: number, patch: Partial<CurvePoint>) => {
    const p = points.map((q, i) => (i === index ? { ...q, ...patch } : q));
    if (index === 0 || index === p.length - 1) p[index].x = index === 0 ? 0 : 1;
    else
      p[index].x = Math.max(
        p[index - 1].x + 0.001,
        Math.min(p[index + 1].x - 0.001, p[index].x),
      );
    return p;
  };
  // Inset the plot so endpoint handles are inside the border, not clipped.
  const pointAt = (x: number, y: number, rect: DOMRect) => ({
    x: Math.max(0.001, Math.min(0.999, ((x - rect.left) / rect.width * 316 - 8) / 300)),
    y: Math.max(0, Math.min(1, 1 - ((y - rect.top) / rect.height * 206 - 8) / 190)),
  });
  return (
    <div className="curve-editor">
      <div className="color-channel-tabs toggle-segmented" role="group" aria-label="Curve channel">
        {(["master", "red", "green", "blue"] as const).map((c) => (
          <button
            type="button"
            key={c}
            className={`seg-btn${channel === c ? " active" : ""}`}
            data-channel={c}
            aria-pressed={channel === c}
            onClick={() => {
              setChannel(c);
              setSelected(0);
              setDraft(null);
            }}
          >
            {c === "master" ? "RGB" : c[0].toUpperCase() + c.slice(1)}
          </button>
        ))}
      </div>
      <svg
        viewBox="-8 -8 316 206"
        role="img"
        aria-label={`${channel} tone curve. Double click to add a point.`}
        onDoubleClick={(e) => {
          const { x, y } = pointAt(e.clientX, e.clientY, e.currentTarget.getBoundingClientRect());
          if (
            points.some((p) => Math.abs(p.x - x) < 0.01) ||
            points.length >= 32
          )
            return;
          const next = normalizeCurve([...points, { x, y }]);
          setSelected(next.findIndex((p) => p.x === x));
          commit(next);
        }}
      >
        {[0.25, 0.5, 0.75].map((v) => (
          <g key={v}>
            <line x1={v * 300} x2={v * 300} y1="0" y2="190" />
            <line x1="0" x2="300" y1={v * 190} y2={v * 190} />
          </g>
        ))}
        <path className="curve-diagonal" d="M0 190 L300 0" />
        <path
          stroke={color}
          d={Array.from(
            { length: 121 },
            (_, i) =>
              `${i ? "L" : "M"}${(i / 120) * 300} ${(1 - sampleCurve(points, i / 120)) * 190}`,
          ).join(" ")}
          fill="none"
          strokeWidth="2"
        />
        {points.map((p, i) => (
          <circle
            key={i}
            cx={p.x * 300}
            cy={(1 - p.y) * 190}
            r={selected === i ? 5 : 4}
            fill={color}
            role="button"
            tabIndex={0}
            aria-label={`Curve point ${i + 1}`}
            aria-pressed={selected === i}
            onFocus={() => setSelected(i)}
            onKeyDown={(e) => {
              if (
                (e.key === "Delete" || e.key === "Backspace") &&
                i > 0 &&
                i < points.length - 1
              ) {
                e.preventDefault();
                commit(points.filter((_, j) => j !== i));
                setSelected(0);
              } else if (e.key.startsWith("Arrow")) {
                e.preventDefault();
                commit(
                  update(i, {
                    x:
                      p.x +
                      (e.key === "ArrowLeft"
                        ? -0.01
                        : e.key === "ArrowRight"
                          ? 0.01
                          : 0),
                    y: Math.max(
                      0,
                      Math.min(
                        1,
                        p.y +
                          (e.key === "ArrowUp"
                            ? 0.01
                            : e.key === "ArrowDown"
                              ? -0.01
                              : 0),
                      ),
                    ),
                  }),
                );
              }
            }}
            onPointerDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setSelected(i);
              const svg = e.currentTarget.ownerSVGElement!,
                r = svg.getBoundingClientRect();
              let next = points;
              const move = (ev: PointerEvent) => {
                next = update(i, {
                  ...pointAt(ev.clientX, ev.clientY, r),
                });
                setDraft(next);
              };
              const up = () => {
                window.removeEventListener("pointermove", move);
                window.removeEventListener("pointerup", up);
                commit(next);
              };
              window.addEventListener("pointermove", move);
              window.addEventListener("pointerup", up, { once: true });
            }}
          />
        ))}
      </svg>
      <div className="color-point-inputs">
        <label>
          Input
          <input
            aria-label="Curve input"
            type="number"
            min="0"
            max="100"
            step="1"
            disabled={!selected || selected === points.length - 1}
            value={Math.round((points[selected]?.x ?? 0) * 100)}
            onChange={(e) =>
              commit(update(selected, { x: Number(e.target.value) / 100 }))
            }
          />
        </label>
        <label>
          Output
          <input
            aria-label="Curve output"
            type="number"
            min="0"
            max="100"
            value={Math.round((points[selected]?.y ?? 0) * 100)}
            onChange={(e) =>
              commit(
                update(selected, {
                  y: Math.max(0, Math.min(1, Number(e.target.value) / 100)),
                }),
              )
            }
          />
        </label>
      </div>
      <div className="color-inline-actions">
        <button
          type="button"
          onClick={() => {
            commit([
              { x: 0, y: 0 },
              { x: 1, y: 1 },
            ]);
            setSelected(0);
          }}
        >
          <RotateCcw size={14} aria-hidden="true" /> Reset channel
        </button>
        <button
          type="button"
          disabled={!selected || selected === points.length - 1}
          onClick={() => {
            commit(points.filter((_, i) => i !== selected));
            setSelected(0);
          }}
        >
          <Minus size={14} aria-hidden="true" /> Remove point
        </button>
      </div>
    </div>
  );
}
