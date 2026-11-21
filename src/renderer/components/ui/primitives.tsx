import { useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import * as RadixSelect from '@radix-ui/react-select';
import * as RadixSwitch from '@radix-ui/react-switch';
import * as RadixSlider from '@radix-ui/react-slider';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { Check, ChevronDown, Minus, Plus, Upload, X } from 'lucide-react';

export function cn(...inputs: Array<string | undefined | null | false>) {
  return twMerge(clsx(inputs));
}

export type ButtonVariant = 'default' | 'primary' | 'soft' | 'ghost' | 'danger' | 'danger-ghost';
export type ButtonSize = 'xs' | 'sm' | 'md';

export function Button({
  variant = 'default',
  size = 'md',
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
}) {
  const variants: Record<ButtonVariant, string> = {
    default:
      'bg-[var(--bg-surface)] text-[var(--ink-primary)] border border-[var(--border-strong)] hover:bg-[var(--bg-hover)] shadow-[var(--shadow-sm)]',
    primary:
      'bg-[var(--accent)] text-[var(--accent-ink)] border border-[var(--accent)] hover:bg-[var(--accent-hover)] shadow-[var(--shadow-sm)]',
    soft:
      'bg-[var(--accent-soft)] text-[var(--accent)] border border-transparent hover:brightness-95',
    ghost:
      'bg-transparent text-[var(--ink-secondary)] border border-transparent hover:bg-[var(--bg-hover)] hover:text-[var(--ink-primary)]',
    danger:
      'bg-[var(--danger)] text-white border border-[var(--danger)] hover:brightness-95',
    'danger-ghost':
      'bg-transparent text-[var(--danger)] border border-transparent hover:bg-[var(--danger-soft)]',
  };
  const sizes: Record<ButtonSize, string> = {
    xs: 'h-7 px-2 text-xs gap-1 rounded-md',
    sm: 'h-8 px-2.5 text-[12.5px] gap-1.5 rounded-lg',
    md: 'h-9 px-3.5 text-[13.5px] gap-1.5 rounded-lg',
  };
  return (
    <button
      type="button"
      className={cn(
        'inline-flex items-center justify-center font-medium whitespace-nowrap transition-colors cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed select-none',
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    />
  );
}

export type BadgeTone = 'neutral' | 'accent' | 'ok' | 'warn' | 'danger' | 'info';

export function Badge({
  tone = 'neutral',
  className,
  children,
}: {
  tone?: BadgeTone;
  className?: string;
  children: ReactNode;
}) {
  const styles: Record<BadgeTone, string> = {
    neutral: 'bg-[var(--bg-muted)] text-[var(--ink-secondary)]',
    accent: 'bg-[var(--accent-soft)] text-[var(--accent)]',
    ok: 'bg-[var(--ok-soft)] text-[var(--ok)]',
    warn: 'bg-[var(--warn-soft)] text-[var(--warn)]',
    danger: 'bg-[var(--danger-soft)] text-[var(--danger)]',
    info: 'bg-[var(--info-soft)] text-[var(--info)]',
  };
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11.5px] font-medium whitespace-nowrap',
        styles[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function Card({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        'bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-xl shadow-[var(--shadow-sm)]',
        className,
      )}
    >
      {children}
    </div>
  );
}

export function Input({
  className,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        'w-full h-9 px-3 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-strong)] text-[13.5px] text-[var(--ink-primary)] placeholder:text-[var(--ink-muted)] focus:outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent-soft)] transition-all',
        className,
      )}
      {...props}
    />
  );
}

export function Textarea({
  className,
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(
        'w-full px-3 py-2 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-strong)] text-[13.5px] text-[var(--ink-primary)] placeholder:text-[var(--ink-muted)] focus:outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent-soft)] transition-all resize-y',
        className,
      )}
      {...props}
    />
  );
}

export function Select({
  value,
  onValueChange,
  options,
  placeholder = '请选择…',
  disabled = false,
  className,
}: {
  value: string;
  onValueChange: (val: string) => void;
  options: Array<{ value: string; label: string; hint?: string }>;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}) {
  const safeVal = options.some((o) => o.value === value) ? value : undefined;
  return (
    <RadixSelect.Root value={safeVal} onValueChange={onValueChange} disabled={disabled}>
      <RadixSelect.Trigger
        className={cn(
          'inline-flex items-center justify-between gap-2 h-8 px-2.5 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-strong)] text-[13px] text-[var(--ink-primary)] hover:bg-[var(--bg-hover)] focus:outline-none focus:border-[var(--accent)] cursor-pointer disabled:opacity-45 min-w-[120px]',
          className,
        )}
      >
        <RadixSelect.Value placeholder={placeholder} />
        <RadixSelect.Icon>
          <ChevronDown className="w-3.5 h-3.5 text-[var(--ink-muted)]" />
        </RadixSelect.Icon>
      </RadixSelect.Trigger>
      <RadixSelect.Portal>
        <RadixSelect.Content
          position="popper"
          sideOffset={5}
          className="z-50 min-w-[var(--radix-select-trigger-width)] max-h-72 overflow-y-auto rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-strong)] p-1 shadow-[var(--shadow-lg)]"
        >
          <RadixSelect.Viewport>
            {options.map((opt) => (
              <RadixSelect.Item
                key={opt.value}
                value={opt.value}
                className="relative flex items-center justify-between gap-3 px-2.5 py-1.5 rounded-lg text-[13px] text-[var(--ink-primary)] cursor-pointer outline-none data-[highlighted]:bg-[var(--accent-soft)] data-[highlighted]:text-[var(--accent)]"
              >
                <div className="flex flex-col min-w-0">
                  <RadixSelect.ItemText>{opt.label}</RadixSelect.ItemText>
                  {opt.hint && (
                    <span className="text-[11px] text-[var(--ink-muted)] truncate">{opt.hint}</span>
                  )}
                </div>
                <RadixSelect.ItemIndicator>
                  <Check className="w-3.5 h-3.5 text-[var(--accent)]" />
                </RadixSelect.ItemIndicator>
              </RadixSelect.Item>
            ))}
          </RadixSelect.Viewport>
        </RadixSelect.Content>
      </RadixSelect.Portal>
    </RadixSelect.Root>
  );
}

export function Switch({
  checked,
  onCheckedChange,
  disabled,
}: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <RadixSwitch.Root
      checked={checked}
      onCheckedChange={onCheckedChange}
      disabled={disabled}
      className={cn(
        'w-9 h-5 rounded-full transition-colors relative cursor-pointer disabled:opacity-45',
        checked ? 'bg-[var(--accent)]' : 'bg-[var(--border-strong)]',
      )}
    >
      <RadixSwitch.Thumb
        className={cn(
          'block w-4 h-4 rounded-full bg-white shadow transition-transform',
          checked ? 'translate-x-[18px]' : 'translate-x-[2px]',
        )}
      />
    </RadixSwitch.Root>
  );
}

export function Slider({
  value,
  min,
  max,
  step = 1,
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (next: number) => void;
}) {
  return (
    <RadixSlider.Root
      value={[value]}
      min={min}
      max={max}
      step={step}
      onValueChange={([v]) => onChange(v)}
      className="relative flex items-center select-none touch-none w-full h-5 cursor-pointer"
    >
      <RadixSlider.Track className="bg-[var(--bg-muted)] relative grow rounded-full h-1.5">
        <RadixSlider.Range className="absolute bg-[var(--accent)] rounded-full h-full" />
      </RadixSlider.Track>
      <RadixSlider.Thumb className="block w-4 h-4 rounded-full bg-white border-2 border-[var(--accent)] shadow hover:scale-110 focus:outline-none transition-transform" />
    </RadixSlider.Root>
  );
}

export function Modal({
  open,
  onOpenChange,
  title,
  subtitle,
  size = 'md',
  footer,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  subtitle?: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  footer?: ReactNode;
  children: ReactNode;
}) {
  const widths = {
    sm: 'max-w-[440px]',
    md: 'max-w-[580px]',
    lg: 'max-w-[820px]',
    xl: 'max-w-[1040px]',
  };
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40 backdrop-blur-[2px]" />
        <Dialog.Content
          className={cn(
            'fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-[calc(100vw-32px)] max-h-[calc(100vh-48px)] flex flex-col bg-[var(--bg-elevated)] border border-[var(--border-strong)] rounded-2xl shadow-[var(--shadow-lg)] overflow-hidden focus:outline-none',
            widths[size],
          )}
        >
          <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-[var(--border-subtle)] shrink-0">
            <div>
              <Dialog.Title className="text-[16px] font-semibold text-[var(--ink-primary)]">
                {title}
              </Dialog.Title>
              {subtitle && (
                <Dialog.Description className="text-[12.5px] text-[var(--ink-muted)] mt-0.5">
                  {subtitle}
                </Dialog.Description>
              )}
            </div>
            <Dialog.Close asChild>
              <button
                type="button"
                aria-label="关闭弹窗"
                className="p-1.5 rounded-lg text-[var(--ink-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--ink-primary)] cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </Dialog.Close>
          </div>
          <div className="px-5 py-4 overflow-y-auto flex-1 min-h-0">{children}</div>
          {footer && (
            <div className="px-5 py-3 border-t border-[var(--border-subtle)] bg-[var(--bg-sidebar)]/60 flex items-center justify-end gap-2 shrink-0">
              {footer}
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function Drawer({
  open,
  onOpenChange,
  title,
  subtitle,
  width = 'max-w-[540px]',
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  subtitle?: string;
  width?: string;
  children: ReactNode;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/30 backdrop-blur-[1px]" />
        <Dialog.Content
          className={cn(
            'fixed right-0 top-0 bottom-0 z-50 w-full flex flex-col bg-[var(--bg-elevated)] border-l border-[var(--border-strong)] shadow-[var(--shadow-lg)] focus:outline-none',
            width,
          )}
        >
          <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-[var(--border-subtle)] shrink-0">
            <div className="min-w-0">
              <Dialog.Title className="text-[16px] font-semibold text-[var(--ink-primary)] truncate">
                {title}
              </Dialog.Title>
              {subtitle && (
                <Dialog.Description className="text-[12.5px] text-[var(--ink-muted)] mt-0.5 truncate">
                  {subtitle}
                </Dialog.Description>
              )}
            </div>
            <Dialog.Close asChild>
              <button
                type="button"
                aria-label="关闭抽屉"
                className="p-1.5 rounded-lg text-[var(--ink-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--ink-primary)] cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </Dialog.Close>
          </div>
          <div className="px-5 py-4 overflow-y-auto flex-1 min-h-0">{children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = '确认',
  danger = false,
  busy = false,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel?: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void | Promise<void>;
}) {
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      size="sm"
      footer={
        <>
          <Button onClick={() => onOpenChange(false)} disabled={busy}>
            取消
          </Button>
          <Button
            variant={danger ? 'danger' : 'primary'}
            disabled={busy}
            onClick={() => void onConfirm()}
          >
            {busy ? '处理中…' : confirmLabel}
          </Button>
        </>
      }
    >
      <p className="text-[13.5px] text-[var(--ink-secondary)] leading-relaxed">{description}</p>
    </Modal>
  );
}

export function NumberStepper({
  label,
  value,
  min,
  max,
  disabled,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  disabled?: boolean;
  onChange: (next: number) => void;
}) {
  const clamp = (n: number) => Math.max(min, Math.min(max, Math.round(n)));
  return (
    <div className="inline-flex items-center gap-0.5 px-1.5 h-8 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-strong)]">
      <span className="text-[12px] text-[var(--ink-muted)] px-1">{label}</span>
      <button
        type="button"
        disabled={disabled || value <= min}
        onClick={() => onChange(clamp(value - 1))}
        className="w-6 h-6 rounded flex items-center justify-center hover:bg-[var(--bg-hover)] disabled:opacity-35 cursor-pointer"
      >
        <Minus className="w-3.5 h-3.5" />
      </button>
      <span className="w-6 text-center text-[13px] font-semibold tabular-nums">{value}</span>
      <button
        type="button"
        disabled={disabled || value >= max}
        onClick={() => onChange(clamp(value + 1))}
        className="w-6 h-6 rounded flex items-center justify-center hover:bg-[var(--bg-hover)] disabled:opacity-35 cursor-pointer"
      >
        <Plus className="w-3.5 h-3.5" />
      </button>
    </div>
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
  const ref = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const pick = (list: FileList | null) => {
    if (list?.length && !disabled) onFiles(Array.from(list));
  };
  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        if (!disabled) setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        pick(e.dataTransfer.files);
      }}
      className={cn(
        'flex items-center gap-3.5 p-4 rounded-xl border-[1.5px] border-dashed transition-colors',
        over
          ? 'border-[var(--accent)] bg-[var(--accent-soft)]'
          : fileName
            ? 'border-solid border-[var(--accent)]/50 bg-[var(--accent-soft)]/50'
            : 'border-[var(--border-strong)] bg-[var(--bg-muted)]/50 hover:border-[var(--accent)]/60',
        disabled && 'opacity-50 pointer-events-none',
      )}
    >
      <input
        ref={ref}
        type="file"
        accept={accept}
        multiple={multiple}
        className="hidden"
        onChange={(e) => {
          pick(e.target.files);
          e.target.value = '';
        }}
      />
      <div className="w-10 h-10 rounded-xl bg-[var(--accent-soft)] text-[var(--accent)] flex items-center justify-center shrink-0">
        <Upload className="w-5 h-5" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[13.5px] font-medium text-[var(--ink-primary)] truncate">
          {fileName ? `已选择：${fileName}` : title}
        </div>
        {hint && <div className="text-[12px] text-[var(--ink-muted)] mt-0.5">{hint}</div>}
      </div>
      <Button size="sm" onClick={() => ref.current?.click()}>
        {fileName ? '重选文件' : '浏览文件'}
      </Button>
    </div>
  );
}
