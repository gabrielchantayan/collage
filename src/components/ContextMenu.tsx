import { useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { LucideIcon } from 'lucide-react';
import type { ClientPoint } from './PhotoTray';
import './ContextMenu.css';

export interface MenuAction {
  label: string;
  icon: LucideIcon;
  onSelect: () => void;
  disabled?: boolean;
  danger?: boolean;
}

interface Props {
  point: ClientPoint;
  actions: MenuAction[];
  onClose: () => void;
}

export default function ContextMenu({ point, actions, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const menu = ref.current!;
    const previousFocus = document.activeElement;
    menu.style.left = `${Math.max(8, Math.min(point.x, window.innerWidth - menu.offsetWidth - 8))}px`;
    menu.style.top = `${Math.max(8, Math.min(point.y, window.innerHeight - menu.offsetHeight - 8))}px`;
    menu.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus({ preventScroll: true });
    const outside = (event: PointerEvent) => { if (!menu.contains(event.target as Node)) onClose(); };
    document.addEventListener('pointerdown', outside, true);
    window.addEventListener('resize', onClose);
    window.addEventListener('scroll', onClose, true);
    window.addEventListener('blur', onClose);
    return () => {
      document.removeEventListener('pointerdown', outside, true);
      window.removeEventListener('resize', onClose);
      window.removeEventListener('scroll', onClose, true);
      window.removeEventListener('blur', onClose);
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, [point.x, point.y, onClose]);

  return createPortal(<div ref={ref} className="context-menu" role="menu" aria-label="Photo actions"
    style={{ left: point.x, top: point.y }} onContextMenu={(event) => event.preventDefault()}
    onKeyDown={(event) => {
      event.stopPropagation();
      if (event.key === 'Escape' || event.key === 'Tab') { event.preventDefault(); onClose(); return; }
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
      const index = items.indexOf(document.activeElement as HTMLButtonElement);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      items[next]?.focus();
    }}>
    {actions.map((action) => <button key={action.label} role="menuitem" disabled={action.disabled}
      className={action.danger ? 'danger' : undefined} onClick={() => { onClose(); action.onSelect(); }}><action.icon size={14} aria-hidden="true" />{action.label}</button>)}
  </div>, document.body);
}
