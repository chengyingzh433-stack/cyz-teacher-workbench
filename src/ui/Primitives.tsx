import { useRef, useState, type ReactNode } from 'react';
import { Icon } from './Icons';

export type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';

export function Badge({ tone = 'neutral', children, className = '' }: { tone?: Tone; children: ReactNode; className?: string }) {
  return <span className={`badge tone-${tone} ${className}`}>{children}</span>;
}

export function Stepper({
  steps,
  current,
  onSelect,
}: {
  steps: { label: string; hint?: string }[];
  current: number;
  onSelect?: (index: number) => void;
}) {
  return (
    <ol className="stepper" aria-label="操作步骤">
      {steps.map((step, i) => {
        const done = i < current;
        const active = i === current;
        const clickable = !!onSelect && done;
        return (
          <li key={step.label} className={`step ${active ? 'active' : done ? 'done' : ''}`} aria-current={active ? 'step' : undefined}>
            <button type="button" disabled={!clickable} onClick={() => clickable && onSelect?.(i)}>
              <span className="step-num">{done ? <Icon name="check" size={13} /> : i + 1}</span>
              <span className="step-text">
                <strong>{step.label}</strong>
                {step.hint && <small>{step.hint}</small>}
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

export function Dropzone({
  accept,
  multiple = false,
  disabled = false,
  title,
  hint,
  fileName,
  onFiles,
}: {
  accept: string;
  multiple?: boolean;
  disabled?: boolean;
  title: string;
  hint?: string;
  fileName?: string;
  onFiles: (files: File[]) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const pick = (list: FileList | null) => list?.length && !disabled && onFiles(Array.from(list));

  return (
    <div
      className={`dropzone ${over ? 'over' : ''} ${disabled ? 'disabled' : ''} ${fileName ? 'has-file' : ''}`}
      onDragOver={(e) => { e.preventDefault(); if (!disabled) setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); pick(e.dataTransfer.files); }}
    >
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple={multiple}
        disabled={disabled}
        className="sr-only"
        onChange={(e) => { pick(e.target.files); e.target.value = ''; }}
      />
      <span className="dropzone-ico"><Icon name="upload" size={20} /></span>
      <div className="dropzone-copy">
        <strong>{fileName ? `已选择：${fileName}` : title}</strong>
        {hint && <span>{hint}</span>}
      </div>
      <button type="button" disabled={disabled} onClick={() => inputRef.current?.click()}>
        {fileName ? '重新选择' : '浏览文件'}
      </button>
    </div>
  );
}

export function NumberStepper({
  label,
  ariaLabel,
  value,
  min,
  max,
  disabled = false,
  onChange,
}: {
  label?: string;
  ariaLabel: string;
  value: number;
  min: number;
  max: number;
  disabled?: boolean;
  onChange: (next: number) => void;
}) {
  const clamp = (n: number) => Math.max(min, Math.min(max, Math.round(n)));
  return (
    <div className="num-stepper">
      {label && <span>{label}</span>}
      <button type="button" aria-label={`减少${ariaLabel}`} disabled={disabled || value <= min} onClick={() => onChange(clamp(value - 1))}>
        <Icon name="minus" size={13} />
      </button>
      <input
        aria-label={ariaLabel}
        inputMode="numeric"
        disabled={disabled}
        value={String(value)}
        onChange={(e) => {
          const parsed = Number(e.target.value);
          if (Number.isFinite(parsed) && e.target.value.trim() !== '') onChange(clamp(parsed));
        }}
      />
      <button type="button" aria-label={`增加${ariaLabel}`} disabled={disabled || value >= max} onClick={() => onChange(clamp(value + 1))}>
        <Icon name="plus" size={13} />
      </button>
    </div>
  );
}

export function EmptyCard({
  icon,
  title,
  description,
  actions,
  footer,
}: {
  icon?: ReactNode;
  title: string;
  description: string;
  actions?: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <section className="empty-card card">
      {icon && <div className="empty-ico">{icon}</div>}
      <h2>{title}</h2>
      <p>{description}</p>
      {actions && <div className="row center">{actions}</div>}
      {footer && <div className="empty-foot">{footer}</div>}
    </section>
  );
}

export function Pager({ page, total, pageSize, unit = '人', onChange }: { page: number; total: number; pageSize: number; unit?: string; onChange: (p: number) => void }) {
  if (total <= pageSize) return null;
  const pages = Math.ceil(total / pageSize);
  return (
    <div className="pager">
      <button type="button" className="sm" disabled={page === 0} onClick={() => onChange(page - 1)}>上一页</button>
      <span className="muted">第 {page + 1} / {pages} 页（共 {total} {unit}）</span>
      <button type="button" className="sm" disabled={page + 1 >= pages} onClick={() => onChange(page + 1)}>下一页</button>
    </div>
  );
}
