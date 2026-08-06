import { useState, useRef, useCallback, useEffect, useLayoutEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronRight } from "lucide-react";
import { MorphIcon } from "morphicons/react";
import { ChevronDown, ChevronUp } from "lucide";
import "./Dropdown.css";

export interface DropdownOption {
  value: string;
  label: string;
  icon?: ReactNode;
  disabled?: boolean;
  children?: DropdownOption[];
}

interface Props {
  options: DropdownOption[];
  value: string;
  onChange: (value: string) => void;
  icon?: ReactNode;
  placeholder?: string;
  className?: string;
}

export default function Dropdown({ options, value, onChange, icon, placeholder, className }: Props) {
  const [open, setOpen] = useState(false);
  const [hoveredIdx, setHoveredIdx] = useState(-1);
  const [subOpen, setSubOpen] = useState<string | null>(null);
  const [subRect, setSubRect] = useState<DOMRect | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const flatIdxRef = useRef(0);
  const subLeaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clean up submenu leave timer on unmount
  useEffect(() => {
    return () => {
      if (subLeaveTimer.current) clearTimeout(subLeaveTimer.current);
    };
  }, []);

  const selectedOption = findOption(options, value);
  const selectedLabel = selectedOption?.label ?? placeholder ?? "Select...";

  const close = useCallback(() => {
    setOpen(false);
    setHoveredIdx(-1);
    setSubOpen(null);
    setSubRect(null);
  }, []);

  // Close on click outside
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (triggerRef.current?.contains(e.target as Node)) return;
      if (panelRef.current?.contains(e.target as Node)) return;
      close();
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open, close]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (subOpen) {
          setSubOpen(null);
          setSubRect(null);
        } else {
          close();
        }
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, close, subOpen]);

  const toggle = useCallback(() => {
    setOpen((p) => {
      if (!p) flatIdxRef.current = 0;
      return !p;
    });
    setHoveredIdx(-1);
  }, []);

  const select = useCallback(
    (opt: DropdownOption) => {
      if (opt.disabled) return;
      if (opt.children && opt.children.length > 0) return;
      onChange(opt.value);
      close();
    },
    [onChange, close]
  );

  const [triggerRect, setTriggerRect] = useState<DOMRect | null>(null);
  const [panelRect, setPanelRect] = useState<DOMRect | null>(null);

  // Recalculate trigger position when opening
  useEffect(() => {
    if (open && triggerRef.current) {
      setTriggerRect(triggerRef.current.getBoundingClientRect());
    } else {
      setPanelRect(null);
    }
  }, [open]);

  // After the panel actually mounts (via portal) and we know its real
  // rendered width/height, clamp it to stay inside the window bounds.
  // Tauri windows have no browser chrome to scroll into — content
  // positioned past the edge is simply clipped by the OS window, so we
  // must never let `left` push the panel past the right/bottom edge.
  // This is what was cutting off entries like "Headphones (Synaptics HD
  // Audio)" in the sidebar: the panel always anchored to the trigger's
  // left edge with no bounds check, so wide labels ran off-window.
  useLayoutEffect(() => {
    if (open && panelRef.current) {
      setPanelRect(panelRef.current.getBoundingClientRect());
    }
  }, [open, options, triggerRect]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!open) {
        if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown") {
          e.preventDefault();
          flatIdxRef.current = 0;
          setOpen(true);
        }
        return;
      }

      const flat = flattenOptions(options);
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setHoveredIdx((p) => Math.min(p + 1, flat.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setHoveredIdx((p) => Math.max(p - 1, 0));
      } else if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        if (hoveredIdx >= 0 && hoveredIdx < flat.length) {
          select(flat[hoveredIdx]);
        }
      }
    },
    [open, options, hoveredIdx, select]
  );

  const EDGE_MARGIN = 8;
  const panelStyle: React.CSSProperties | undefined = triggerRect
    ? (() => {
        const width = panelRect?.width ?? triggerRect.width;
        const height = panelRect?.height ?? 0;

        // Default: left-aligned with the trigger, like before.
        let left = triggerRect.left;
        // If that would push the panel past the right edge of the window,
        // right-align it to the trigger instead (grow leftward). This is
        // the case that was clipping long labels in the sidebar, since the
        // sidebar sits at the right edge of the window with little room to
        // the right of its triggers.
        if (left + width > window.innerWidth - EDGE_MARGIN) {
          left = triggerRect.right - width;
        }
        // Still clamp to the left edge as a last resort (very narrow window).
        left = Math.max(EDGE_MARGIN, left);

        let top = triggerRect.bottom + 4;
        // If it would overflow the bottom edge, open upward instead.
        if (height && top + height > window.innerHeight - EDGE_MARGIN) {
          top = Math.max(EDGE_MARGIN, triggerRect.top - height - 4);
        }

        return {
          position: "fixed" as const,
          top,
          left,
          minWidth: triggerRect.width,
        };
      })()
    : undefined;

  const handleSubEnter = useCallback((optValue: string, el: HTMLElement) => {
    const rect = el.getBoundingClientRect();
    setSubOpen(optValue);
    setSubRect(rect);
  }, []);

  const handleSubLeave = useCallback(() => {
    if (subLeaveTimer.current) clearTimeout(subLeaveTimer.current);
    subLeaveTimer.current = setTimeout(() => {
      setSubOpen(null);
      setSubRect(null);
    }, 150);
  }, []);

  const selectedValue = value;

  return (
    <>
      {/* Trigger */}
      <button
        ref={triggerRef}
        className={`dd-trigger ${open ? "open" : ""} ${className ?? ""}`}
        onClick={toggle}
        onKeyDown={handleKeyDown}
        title={selectedLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        {icon && <span className="dd-trigger-icon">{icon}</span>}
        <span className="dd-trigger-label">{selectedLabel}</span>
        <span className="dd-trigger-chevron">
          <MorphIcon icon={open ? ChevronUp : ChevronDown} spring="snappy" size={14} />
        </span>
      </button>

      {/* Dropdown panel portal */}
      {open &&
        createPortal(
          <div
            ref={panelRef}
            className={`dd-panel ${open ? "open" : ""}`}
            style={panelStyle}
          >
            <DropdownList
              options={options}
              depth={0}
              selectedValue={selectedValue}
              hoveredIdx={hoveredIdx}
              onSelect={select}
              onHover={setHoveredIdx}
              listRef={listRef}
              flatIdxRef={flatIdxRef}
              subOpen={subOpen}
              subRect={subRect}
              onSubEnter={handleSubEnter}
              onSubLeave={handleSubLeave}
              setSubOpen={setSubOpen}
              setSubRect={setSubRect}
              close={close}
            />
          </div>,
          document.body
        )}
    </>
  );
}

/* ── Internal helpers ──────────────────────────────────────────────────── */

function findOption(opts: DropdownOption[], val: string): DropdownOption | undefined {
  for (const o of opts) {
    if (o.value === val) return o;
    if (o.children) {
      const found = findOption(o.children, val);
      if (found) return found;
    }
  }
  return undefined;
}

function flattenOptions(opts: DropdownOption[]): DropdownOption[] {
  const result: DropdownOption[] = [];
  for (const o of opts) {
    result.push(o);
    if (o.children) result.push(...flattenOptions(o.children));
  }
  return result;
}

/* ── Recursive dropdown list ───────────────────────────────────────────── */

function DropdownList({
  options,
  depth,
  selectedValue,
  hoveredIdx,
  onSelect,
  onHover,
  listRef,
  flatIdxRef,
  subOpen,
  subRect,
  onSubEnter,
  onSubLeave,
  setSubOpen,
  setSubRect,
  close,
}: {
  options: DropdownOption[];
  depth: number;
  selectedValue: string;
  hoveredIdx: number;
  onSelect: (opt: DropdownOption) => void;
  onHover: (idx: number) => void;
  listRef: React.RefObject<HTMLUListElement | null>;
  flatIdxRef: React.MutableRefObject<number>;
  subOpen: string | null;
  subRect: DOMRect | null;
  onSubEnter: (val: string, el: HTMLElement) => void;
  onSubLeave: () => void;
  setSubOpen: (v: string | null) => void;
  setSubRect: (r: DOMRect | null) => void;
  close: () => void;
}) {
  flatIdxRef.current = 0;
  return (
    <ul ref={depth === 0 ? listRef : undefined} role="listbox" style={{ listStyle: "none", padding: 0, margin: 0 }}>
      {options.map((opt) => {
        const idx = flatIdxRef.current++;
        const isSelected = selectedValue === opt.value;
        const hasChildren = opt.children && opt.children.length > 0;

        return (
          <li key={opt.value} role="option" aria-selected={isSelected}>
            <button
              className="dd-item"
              disabled={opt.disabled}
              onClick={() => onSelect(opt)}
              onMouseEnter={(e) => {
                onHover(idx);
                if (hasChildren) onSubEnter(opt.value, e.currentTarget);
              }}
              onMouseLeave={() => {
                if (hasChildren) onSubLeave();
              }}
            >
              <span className="dd-item-check">
                {isSelected && <Check size={14} strokeWidth={2.5} />}
              </span>
              {opt.icon && <span className="dd-trigger-icon">{opt.icon}</span>}
              <span className="dd-item-label">{opt.label}</span>
              {hasChildren && (
                <span className="dd-item-chevron">
                  <ChevronRight size={14} />
                </span>
              )}
            </button>

            {/* Nested submenu portal */}
            {hasChildren && subOpen === opt.value && subRect && depth < 2 &&
              createPortal(
                <div
                  className="dd-sub-panel"
                  style={{
                    position: "fixed",
                    top: subRect.top,
                    left: subRect.right + 4,
                  }}
                  onMouseEnter={() => setSubOpen(opt.value)}
                  onMouseLeave={() => {
                    setSubOpen(null);
                    setSubRect(null);
                  }}
                >
                  <DropdownList
                    options={opt.children!}
                    depth={depth + 1}
                    selectedValue={selectedValue}
                    hoveredIdx={hoveredIdx}
                    onSelect={onSelect}
                    onHover={onHover}
                    listRef={listRef}
                    flatIdxRef={flatIdxRef}
                    subOpen={null}
                    subRect={null}
                    onSubEnter={() => {}}
                    onSubLeave={() => {}}
                    setSubOpen={setSubOpen}
                    setSubRect={setSubRect}
                    close={close}
                  />
                </div>,
                document.body
              )}
          </li>
        );
      })}
    </ul>
  );
}
