import { useId, type ReactNode } from "react";

/** Always-visible controls with a non-interactive section heading. */
export default function ColorSection({ title, children }: {
  title: string;
  children: ReactNode;
}) {
  const headingId = useId();
  return (
    <section className="color-section" aria-labelledby={headingId}>
      <h4 className="color-section-heading" id={headingId}>{title}</h4>
      <div className="color-section-body">{children}</div>
    </section>
  );
}
