import { useState, useRef, useCallback } from "react";
import "./RegionSelector.css";

interface Props {
  onSelect: (region: { x: number; y: number; w: number; h: number }) => void;
  onCancel: () => void;
}

export default function RegionSelector({ onSelect, onCancel }: Props) {
  const [dragging, setDragging] = useState(false);
  const [start, setStart] = useState({ x: 0, y: 0 });
  const [end, setEnd] = useState({ x: 0, y: 0 });
  const overlayRef = useRef<HTMLDivElement>(null);

  const getRect = useCallback(() => {
    const x = Math.min(start.x, end.x);
    const y = Math.min(start.y, end.y);
    const w = Math.abs(end.x - start.x);
    const h = Math.abs(end.y - start.y);
    return { x, y, w, h };
  }, [start, end]);

  const onMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    setDragging(true);
    setStart({ x: e.clientX, y: e.clientY });
    setEnd({ x: e.clientX, y: e.clientY });
  };

  const onMouseMove = (e: React.MouseEvent) => {
    if (!dragging) return;
    setEnd({ x: e.clientX, y: e.clientY });
  };

  const onMouseUp = () => {
    if (!dragging) return;
    setDragging(false);
    const rect = getRect();
    if (rect.w > 20 && rect.h > 20) {
      onSelect(rect);
    }
  };

  const r = getRect();

  return (
    <div
      ref={overlayRef}
      className="region-overlay"
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
    >
      <div className="region-hint">
        {dragging
          ? "Release to select region"
          : "Click and drag to select recording area"}
      </div>

      {dragging && r.w > 0 && r.h > 0 && (
        <div
          className="region-box"
          style={{
            left: r.x,
            top: r.y,
            width: r.w,
            height: r.h,
          }}
        >
          <span className="region-size">{r.w} x {r.h}</span>
        </div>
      )}

      <button className="region-cancel" onClick={onCancel}>
        Cancel
      </button>
    </div>
  );
}
