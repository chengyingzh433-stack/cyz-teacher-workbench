import { useEffect, useRef, type ReactNode } from 'react';
import { Icon } from './Icons';

export function Modal({
  title,
  subtitle,
  children,
  footer,
  onClose,
  wide = false,
  extraWide = false,
  drawer = false,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
  onClose: () => void;
  wide?: boolean;
  extraWide?: boolean;
  drawer?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el && !el.open) el.showModal();
    return () => { if (el?.open) el.close(); };
  }, []);
  return (
    <dialog
      ref={ref}
      className={`dialog ${extraWide ? 'xl' : wide ? 'wide' : ''} ${drawer ? 'drawer' : ''}`}
      aria-label={title}
      onCancel={(e) => { e.preventDefault(); onClose(); }}
      onClick={(e) => { if (e.target === ref.current) onClose(); }}
    >
      <div className="dialog-shell">
        <div className="dialog-head">
          <div>
            <h2>{title}</h2>
            {subtitle && <p className="tip">{subtitle}</p>}
          </div>
          <button type="button" className="ghost" onClick={onClose} aria-label="关闭弹窗" title="关闭 (Esc)">
            <Icon name="x" size={17} />
          </button>
        </div>
        <div className="dialog-body">{children}</div>
        {footer && <div className="dialog-foot">{footer}</div>}
      </div>
    </dialog>
  );
}

export function ErrorText({ message }: { message: string }) {
  return message ? <div role="alert" className="alert tone-danger">{message}</div> : null;
}
