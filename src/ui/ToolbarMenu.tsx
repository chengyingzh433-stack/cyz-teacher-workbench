import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Icon } from './Icons';

export function ToolbarMenu({
  label,
  icon,
  className = '',
  children,
}: {
  label: string;
  icon?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const dismiss = (e: PointerEvent) => {
      if (e.target instanceof Node && !ref.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, [open]);
  return (
    <details
      ref={ref}
      open={open}
      className={`menu ${className}`}
      onToggle={(e) => setOpen(e.currentTarget.open)}
      onClick={(e) => { if ((e.target as Element).closest('.menu-pop > button')) setOpen(false); }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          setOpen(false);
          ref.current?.querySelector('summary')?.focus();
        }
      }}
    >
      <summary>{icon}<span>{label}</span><Icon name="chevronDown" size={14} /></summary>
      {children}
    </details>
  );
}
