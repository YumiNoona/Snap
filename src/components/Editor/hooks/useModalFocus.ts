import { useEffect, useRef } from "react";

/** Keep keyboard focus in the foremost dialog, then return it to its opener. */
export function useModalFocus(open: boolean) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!open || !ref.current) return;
    const root = ref.current,
      previous = document.activeElement as HTMLElement | null;
    const elements = () =>
      [
        ...root.querySelectorAll<HTMLElement>(
          'button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]',
        ),
      ].filter((el) => el.getClientRects().length > 0);
    (elements()[0] ?? root).focus();
    const backdrop = root.parentElement;
    const siblings = [...(backdrop?.parentElement?.children ?? [])].filter(
      (el) => el !== backdrop && el instanceof HTMLElement,
    ) as HTMLElement[];
    const inert = siblings.map((el) => el.inert);
    siblings.forEach((el) => {
      el.inert = true;
    });
    const trap = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const items = elements(),
        first = items[0],
        last = items[items.length - 1];
      if (!first) {
        event.preventDefault();
        root.focus();
      } else if (
        !root.contains(document.activeElement) ||
        (event.shiftKey && document.activeElement === first) ||
        (!event.shiftKey && document.activeElement === last)
      ) {
        event.preventDefault();
        (event.shiftKey ? last : first)?.focus();
      }
    };
    root.addEventListener("keydown", trap);
    return () => {
      root.removeEventListener("keydown", trap);
      siblings.forEach((el, i) => {
        el.inert = inert[i];
      });
      if (previous?.isConnected) previous.focus();
    };
  }, [open]);
  return ref;
}
