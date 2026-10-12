import { useState, useRef, useEffect, useLayoutEffect, useId, type ReactNode } from "react";
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
  ariaLabel?: string;
}
interface Branch { option: DropdownOption; anchor: HTMLElement; keyboard: boolean }

function findOption(options: DropdownOption[], value: string): DropdownOption | undefined {
  for (const option of options) {
    if (option.value === value) return option;
    const child = option.children && findOption(option.children, value);
    if (child) return child;
  }
}

function Menu({ options, value, owner, anchor, nested, keyboard, onChoose, onBranch, onBack, onClose }: {
  options: DropdownOption[]; value: string; owner: string; anchor: HTMLElement;
  nested: boolean; keyboard: boolean; onChoose: (option: DropdownOption) => void;
  onBranch: (option: DropdownOption | null, element: HTMLElement, keyboard: boolean) => void;
  onBack: () => void; onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: 8, top: 8, visibility: "hidden" as "hidden" | "visible" });
  useLayoutEffect(() => {
    const place = () => {
      const rect = anchor.getBoundingClientRect(), menu = ref.current?.getBoundingClientRect();
      if (!menu) return;
      const width = menu.width, height = menu.height, edge = 8;
      let left = nested ? rect.right + 4 : rect.left;
      if (left + width > window.innerWidth - edge) left = nested ? rect.left - width - 4 : rect.right - width;
      let top = nested ? rect.top : rect.bottom + 4;
      if (top + height > window.innerHeight - edge) top = nested ? window.innerHeight - height - edge : rect.top - height - 4;
      setPosition({ left: Math.max(edge, left), top: Math.max(edge, top), visibility: "visible" });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => { window.removeEventListener("resize", place); window.removeEventListener("scroll", place, true); };
  }, [anchor, nested, keyboard, options]);
  useLayoutEffect(() => {
    if (keyboard && position.visibility === "visible") {
      ref.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
    }
  }, [keyboard, position.visibility]);
  const navigate = (event: React.KeyboardEvent) => {
    const items = Array.from(ref.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? []);
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onClose(); }
    else if (event.key === "ArrowLeft" && nested) { event.preventDefault(); event.stopPropagation(); onBack(); anchor.focus(); }
    else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key) && items.length) {
      event.preventDefault(); event.stopPropagation();
      const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : (current + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
      items[next].focus();
    }
  };
  return createPortal(<div ref={ref} data-dropdown-owner={owner} className={nested ? "dd-sub-panel" : "dd-panel open"}
    style={{ ...position, minWidth: nested ? 180 : Math.min(anchor.getBoundingClientRect().width, window.innerWidth - 16), maxWidth: "calc(100vw - 16px)", maxHeight: "calc(100vh - 16px)" }} onKeyDown={navigate}>
    <ul role="listbox" style={{ listStyle: "none", padding: 0, margin: 0 }}>
      {options.map(option => <li key={option.value} role="option" aria-selected={option.value === value}>
        <button type="button" className="dd-item" disabled={option.disabled}
          aria-haspopup={option.children?.length ? "listbox" : undefined}
          onMouseEnter={event => onBranch(option.children?.length ? option : null, event.currentTarget, false)}
          onClick={event => option.children?.length ? onBranch(option, event.currentTarget, true) : onChoose(option)}
          onKeyDown={event => {
            if (event.key === "ArrowRight" && option.children?.length) {
              event.preventDefault(); event.stopPropagation(); onBranch(option, event.currentTarget, true);
            }
          }}>
          <span className="dd-item-check">{option.value === value && <Check size={14} strokeWidth={2.5}/>}</span>
          {option.icon && <span className="dd-trigger-icon">{option.icon}</span>}
          <span className="dd-item-label">{option.label}</span>
          {!!option.children?.length && <span className="dd-item-chevron"><ChevronRight size={14}/></span>}
        </button>
      </li>)}
    </ul>
  </div>, document.body);
}

export default function Dropdown({ options, value, onChange, icon, placeholder, className, ariaLabel }: Props) {
  const [open, setOpen] = useState(false);
  const [branches, setBranches] = useState<Branch[]>([]);
  const trigger = useRef<HTMLButtonElement>(null);
  const owner = useId();
  const close = () => { setOpen(false); setBranches([]); trigger.current?.focus(); };
  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => {
      const target = event.target as HTMLElement;
      if (trigger.current?.contains(target) || target.closest?.("[data-dropdown-owner]")?.getAttribute("data-dropdown-owner") === owner) return;
      setOpen(false); setBranches([]);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.stopPropagation(); setOpen(false); setBranches([]); trigger.current?.focus(); }
    };
    const blur = () => { setOpen(false); setBranches([]); };
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", escape);
    window.addEventListener("blur", blur);
    return () => { document.removeEventListener("pointerdown", dismiss); document.removeEventListener("keydown", escape); window.removeEventListener("blur", blur); };
  }, [open, owner]);
  const branch = (depth: number, option: DropdownOption | null, anchor: HTMLElement, keyboard: boolean) => {
    setBranches(previous => [...previous.slice(0, depth), ...(option ? [{ option, anchor, keyboard }] : [])]);
  };
  const choose = (option: DropdownOption) => { if (!option.disabled) { onChange(option.value); close(); } };
  const label = findOption(options, value)?.label ?? placeholder ?? "Select...";
  return <>
    <button ref={trigger} type="button" className={`dd-trigger ${open ? "open" : ""} ${className ?? ""}`}
      aria-label={ariaLabel} aria-haspopup="listbox" aria-expanded={open} title={label}
      onClick={() => { setOpen(previous => !previous); setBranches([]); }}
      onKeyDown={event => {
        if (["Enter", " ", "ArrowDown", "ArrowUp"].includes(event.key)) { event.preventDefault(); setOpen(true); setBranches([]); }
      }}>
      {icon && <span className="dd-trigger-icon">{icon}</span>}
      <span className="dd-trigger-label">{label}</span>
      <span className="dd-trigger-chevron"><MorphIcon icon={open ? ChevronUp : ChevronDown} spring="snappy" size={14}/></span>
    </button>
    {open && trigger.current && <Menu options={options} value={value} owner={owner} anchor={trigger.current} nested={false} keyboard={true}
      onChoose={choose} onBranch={(option, anchor, keyboard) => branch(0, option, anchor, keyboard)} onBack={close} onClose={close}/>}
    {open && branches.map((entry, depth) => <Menu key={entry.option.value} options={entry.option.children!} value={value} owner={owner}
      anchor={entry.anchor} nested={true} keyboard={entry.keyboard} onChoose={choose}
      onBranch={(option, anchor, keyboard) => branch(depth + 1, option, anchor, keyboard)}
      onBack={() => setBranches(previous => previous.slice(0, depth))} onClose={close}/>)}
  </>;
}
