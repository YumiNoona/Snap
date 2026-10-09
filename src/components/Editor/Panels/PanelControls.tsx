import { useState, useEffect, useLayoutEffect, useRef, useId, type CSSProperties } from "react";
import { ChevronDown, Check } from "lucide-react";
export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="ss-section"><h4 className="ss-section-heading">{title}</h4><div className="ss-section-body">{children}</div></section>;
}

export function SelectRow({ label, value, options, optionLabels, onChange }: { label: string; value: string; options: string[]; optionLabels?: Record<string, string>; onChange: (value: string) => void }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const [menuLayout, setMenuLayout] = useState<CSSProperties>({});
  const optionLabel = (option: string) => optionLabels?.[option] ?? option.replace(/([A-Z])/g, " $1").replace(/^./, (char) => char.toUpperCase());

  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const trigger = triggerRef.current?.getBoundingClientRect();
      if (!trigger) return;
      const boundary = rootRef.current?.closest?.(".ss-panels-drawer, .timeline-clip-inspector")?.getBoundingClientRect();
      const below = Math.max(40, Math.min(boundary?.bottom ?? window.innerHeight, window.innerHeight) - trigger.bottom - 12);
      const above = Math.max(40, trigger.top - Math.max(boundary?.top ?? 0, 0) - 12);
      const upwards = below < Math.min(238, options.length * 37 + 10) && above > below;
      setMenuLayout({ top: upwards ? "auto" : "calc(100% + 6px)", bottom: upwards ? "calc(100% + 6px)" : "auto", maxHeight: Math.min(238, upwards ? above : below) });
    };
    place();
    menuRef.current?.querySelector?.<HTMLButtonElement>("[aria-selected='true']")?.focus?.();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [open, options.length]);

  const close = () => { setOpen(false); triggerRef.current?.focus?.(); };
  const navigate = (event: React.KeyboardEvent) => {
    if (!["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight", "Home", "End", "Escape"].includes(event.key)) return;
    event.stopPropagation();
    event.preventDefault();
    if (event.key === "Escape") { close(); return; }
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") return;
    if (!open) { setOpen(true); return; }
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>("[role='option']") ?? []);
    if (!items.length) return;
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : (current + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
    items[next].focus();
  };

  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    window.addEventListener("pointerdown", dismiss);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("pointerdown", dismiss);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  return (
    <div className="field-row select-row custom-select-row" ref={rootRef}>
      <span className="field-label">{label}</span>
      <div className="custom-select">
        <button ref={triggerRef} type="button" className={`custom-select-trigger ${open ? "open" : ""}`} aria-label={label} aria-haspopup="listbox" aria-controls={menuId} aria-expanded={open} onKeyDown={navigate} onClick={() => setOpen((current) => !current)}>
          <span>{optionLabel(value)}</span><ChevronDown size={14} />
        </button>
        {open && <div ref={menuRef} id={menuId} style={menuLayout} className="custom-select-menu" role="listbox" aria-label={label} onKeyDown={navigate}>
          {options.map((option) => <button type="button" role="option" aria-selected={option === value} key={option} onClick={() => { onChange(option); close(); }}><span>{optionLabel(option)}</span>{option === value && <Check size={14} />}</button>)}
        </div>}
      </div>
    </div>
  );
}

export function CheckRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button type="button" className="field-row check-row" onClick={() => onChange(!checked)} aria-pressed={checked}>
      <span className="field-label">{label}</span>
      <span className={`pro-switch ${checked ? "checked" : ""}`} aria-hidden="true"><span /></span>
    </button>
  );
}

