import { useEffect, useState } from 'react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';

export function IconButton({ label, children, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; children: ReactNode }) {
  return <button type="button" className="icon-button" title={label} aria-label={label} {...props}>{children}</button>;
}

export function NumberField({ label, value, min, max, suffix, onCommit }: {
  label: string; value: number; min: number; max: number; suffix?: string; onCommit: (value: number) => void;
}) {
  const [draft, setDraft] = useState(String(Math.round(value)));
  useEffect(() => setDraft(String(Math.round(value))), [value]);
  return <label className="number-field"><span>{label}</span><div>
    <input type="number" value={draft} min={min} max={max} aria-label={label}
      onChange={(event) => setDraft(event.target.value)}
      onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); }}
      onBlur={() => {
        const parsed = Number(draft);
        const next = draft.trim() && Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : value;
        setDraft(String(Math.round(next)));
        if (next !== value) onCommit(next);
      }} />
    {suffix && <span>{suffix}</span>}
  </div></label>;
}
