import { HelpCircle, Plus, X } from 'lucide-react';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';

/**
 * ESC closes the top-most open panel / dialog (Chi tiết bài, Cài đặt, Hỏi nhanh, đăng nhập) exactly like its X button.
 * Panels register in open order; one key press closes only the last one. A small menu open inside a panel handles its
 * own ESC first and calls preventDefault(), so the panel under it stays open.
 */
const escStack: Array<{ current: () => void }> = [];
let escBound = false;
export function useEscape(onEscape: () => void, active = true) {
  const ref = useRef(onEscape);
  ref.current = onEscape;
  useEffect(() => {
    if (!active) return;
    if (!escBound) {
      escBound = true;
      window.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape' || e.defaultPrevented || e.isComposing || !escStack.length) return;
        e.preventDefault();
        escStack[escStack.length - 1]!.current();
      });
    }
    escStack.push(ref);
    return () => {
      const i = escStack.lastIndexOf(ref);
      if (i >= 0) escStack.splice(i, 1);
    };
  }, [active]);
}

/* ---------------- Toasts ---------------- */
type Toast = { id: number; kind: 'ok' | 'err' | 'info'; text: string };
const ToastCtx = createContext<(kind: Toast['kind'], text: string) => void>(() => {});
export function ToastProvider({ children }: { children: ReactNode }) {
  const [list, setList] = useState<Toast[]>([]);
  const push = useCallback((kind: Toast['kind'], text: string) => {
    const id = Date.now() + Math.random();
    // the same message already on screen (e.g. one failed batch of several stories) is shown once
    setList((l) => (l.some((t) => t.kind === kind && t.text === text) ? l : [...l, { id, kind, text }]));
    setTimeout(() => setList((l) => l.filter((t) => t.id !== id)), kind === 'err' ? 9000 : 4000);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="fixed bottom-4 right-4 z-[100] flex max-w-md flex-col gap-2" role="status" aria-live="polite">
        {list.map((t) => (
          <div key={t.id} className={`rounded-md border px-3 py-2 text-sm shadow-lg ${t.kind === 'ok' ? 'border-green-300 bg-green-50 text-green-900' : t.kind === 'err' ? 'border-red-300 bg-red-50 text-red-900' : 'border-slate-300 bg-white'}`}>
            {t.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);

/* ---------------- Form primitives ---------------- */
export function Help({ text }: { text: string }) {
  return (
    <span className="group relative inline-flex align-middle" tabIndex={0} aria-label={text}>
      <HelpCircle className="h-3.5 w-3.5 text-slate-400" />
      <span className="pointer-events-none absolute left-5 top-0 z-50 hidden w-64 rounded bg-slate-800 px-2 py-1 text-xs font-normal text-white shadow group-hover:block group-focus:block">{text}</span>
    </span>
  );
}

export function Field({ label, help, error, children }: { label: string; help?: string; error?: string | null; children: ReactNode }) {
  return (
    <label className="block">
      <span className="label flex items-center gap-1">
        {label} {help && <Help text={help} />}
      </span>
      {children}
      {error && <span className="mt-0.5 block text-xs text-red-600">{error}</span>}
    </label>
  );
}

export function Toggle({ checked, onChange, label, help, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; help?: string; disabled?: boolean }) {
  return (
    <label className={`flex items-center gap-2 py-1 text-sm ${disabled ? 'opacity-60' : 'cursor-pointer'}`}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative h-5 w-9 shrink-0 rounded-full transition ${checked ? 'bg-teal-600' : 'bg-slate-300'}`}
      >
        <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition ${checked ? 'left-[18px]' : 'left-0.5'}`} />
      </button>
      <span>{label}</span>
      {help && <Help text={help} />}
    </label>
  );
}

export function NumberField({ label, value, onChange, min, max, step = 1, help, suffix }: { label: string; value: number; onChange: (v: number) => void; min: number; max: number; step?: number; help?: string; suffix?: string }) {
  const err = value < min || value > max || Number.isNaN(value) ? `Giá trị từ ${min} đến ${max}` : null;
  return (
    <Field label={label} help={help} error={err}>
      <div className="flex items-center gap-2">
        <input type="range" min={min} max={max} step={step} value={Number.isNaN(value) ? min : value} onChange={(e) => onChange(Number(e.target.value))} className="flex-1 accent-teal-600" aria-label={`${label} (thanh trượt)`} />
        <input type="number" className="input w-24" min={min} max={max} step={step} value={Number.isNaN(value) ? '' : value} onChange={(e) => onChange(e.target.valueAsNumber)} aria-label={label} />
        {suffix && <span className="text-xs text-slate-500">{suffix}</span>}
      </div>
    </Field>
  );
}

export function Select<T extends string>({ label, value, onChange, options, help }: { label: string; value: T; onChange: (v: T) => void; options: Array<[T, string]>; help?: string }) {
  return (
    <Field label={label} help={help}>
      <select className="input" value={value} onChange={(e) => onChange(e.target.value as T)}>
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </Field>
  );
}

/** Chip editor for keyword/alias lists. Enter or comma adds; × removes. */
export function ChipEditor({ values, onChange, placeholder, validate, max = 500, label, help }: { values: string[]; onChange: (v: string[]) => void; placeholder?: string; validate?: (v: string) => string | null; max?: number; label?: string; help?: string }) {
  const [draft, setDraft] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const add = () => {
    const parts = draft.split(/[,\n]/).map((s) => s.trim()).filter(Boolean);
    if (!parts.length) return;
    for (const p of parts) {
      const e = validate?.(p) ?? null;
      if (e) return setErr(e);
    }
    const next = [...values];
    for (const p of parts) if (!next.some((x) => x.toLowerCase() === p.toLowerCase())) next.push(p);
    if (next.length > max) return setErr(`Tối đa ${max} mục`);
    onChange(next);
    setDraft('');
    setErr(null);
  };
  return (
    <div>
      {label && (
        <span className="label flex items-center gap-1">
          {label} {help && <Help text={help} />} <span className="font-normal text-slate-400">({values.length})</span>
        </span>
      )}
      <div className="flex flex-wrap gap-1 rounded-md border border-slate-300 bg-white p-1.5">
        {values.map((v) => (
          <span key={v} className="chip border-teal-200 bg-teal-50 text-teal-800">
            {v}
            <button type="button" aria-label={`Xóa ${v}`} onClick={() => onChange(values.filter((x) => x !== v))} className="text-teal-600 hover:text-red-600">
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
        <input
          className="min-w-[10rem] flex-1 px-1 py-0.5 text-sm outline-none"
          value={draft}
          placeholder={placeholder ?? 'Nhập rồi Enter'}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ',') {
              e.preventDefault();
              add();
            } else if (e.key === 'Backspace' && !draft && values.length) onChange(values.slice(0, -1));
          }}
          onBlur={add}
        />
      </div>
      {err && <span className="text-xs text-red-600">{err}</span>}
    </div>
  );
}

export function urlError(v: string): string | null {
  try {
    const u = new URL(v);
    if (!/^https?:$/.test(u.protocol)) return 'Chỉ chấp nhận http:// hoặc https://';
    if (/^(localhost|127\.|10\.|192\.168\.|169\.254\.)/.test(u.hostname)) return 'Không cho phép địa chỉ nội bộ';
    return null;
  } catch {
    return `URL không hợp lệ: "${v}" (cần bắt đầu bằng https://)`;
  }
}

export function UrlList({ label, values, onChange, help, verified = [] }: { label: string; values: string[]; onChange: (v: string[]) => void; help?: string; verified?: string[] }) {
  const [draft, setDraft] = useState('');
  const err = draft ? urlError(draft) : null;
  return (
    <div>
      <span className="label flex items-center gap-1">
        {label} {help && <Help text={help} />} <span className="font-normal text-slate-400">({values.length})</span>
      </span>
      <ul className="mb-1 space-y-1">
        {values.map((v, i) => (
          <li key={v} className="flex items-center gap-1 text-xs">
            <span className={`chip ${verified.includes(v) ? 'border-green-300 bg-green-50 text-green-800' : 'border-amber-300 bg-amber-50 text-amber-800'}`}>{verified.includes(v) ? 'đã kiểm' : 'giả thuyết'}</span>
            <span className="flex-1 truncate font-mono" title={v}>{v}</span>
            <button type="button" className="btn-ghost btn-xs" disabled={i === 0} onClick={() => { const n = [...values]; [n[i - 1], n[i]] = [n[i]!, n[i - 1]!]; onChange(n); }} aria-label="Lên">↑</button>
            <button type="button" className="btn-danger btn-xs" onClick={() => onChange(values.filter((x) => x !== v))} aria-label={`Xóa ${v}`}>
              <X className="h-3 w-3" />
            </button>
          </li>
        ))}
      </ul>
      <div className="flex gap-1">
        <input className="input font-mono text-xs" placeholder="https://..." value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), !err && draft && (onChange([...values, draft.trim()]), setDraft('')))} />
        <button type="button" className="btn-ghost" disabled={!draft || !!err} onClick={() => { onChange([...values, draft.trim()]); setDraft(''); }}>
          <Plus className="h-3.5 w-3.5" /> Thêm
        </button>
      </div>
      {err && <span className="text-xs text-red-600">{err}</span>}
    </div>
  );
}

export function Section({ title, children, actions, help }: { title: string; children: ReactNode; actions?: ReactNode; help?: string }) {
  return (
    <section className="card mb-4 p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-1 text-sm font-semibold text-navy-700">
          {title} {help && <Help text={help} />}
        </h3>
        {actions}
      </div>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

export const STATE_LABEL: Record<string, string> = {
  discovered: 'Mới phát hiện', fetch_queued: 'Chờ tải', fetched: 'Đã tải', parsed_complete: 'Bóc tách đủ', parsed_partial: 'Bóc tách thiếu',
  date_unverified: 'Chưa xác minh giờ', outside_window: 'Ngoài khung giờ', irrelevant_with_evidence: 'Không liên quan (có lý do)', duplicate: 'Trùng lặp',
  blocked: 'Bị chặn', fetch_failed: 'Lỗi tải', parse_failed: 'Lỗi bóc tách', retry_pending: 'Chờ thử lại', ready_for_review: 'Chờ duyệt', reviewed: 'Đã duyệt',
};
export const STATE_COLOR: Record<string, string> = {
  ready_for_review: 'border-green-300 bg-green-50 text-green-800', reviewed: 'border-green-400 bg-green-100 text-green-900',
  parsed_partial: 'border-amber-300 bg-amber-50 text-amber-800', date_unverified: 'border-amber-300 bg-amber-50 text-amber-800', retry_pending: 'border-amber-300 bg-amber-50 text-amber-800',
  blocked: 'border-red-300 bg-red-50 text-red-800', fetch_failed: 'border-red-300 bg-red-50 text-red-800', parse_failed: 'border-red-300 bg-red-50 text-red-800',
  outside_window: 'border-slate-300 bg-slate-50 text-slate-600', irrelevant_with_evidence: 'border-slate-300 bg-slate-50 text-slate-600', duplicate: 'border-slate-300 bg-slate-100 text-slate-600',
};
export function StateChip({ state }: { state: string }) {
  return <span className={`chip ${STATE_COLOR[state] ?? 'border-blue-300 bg-blue-50 text-blue-800'}`}>{STATE_LABEL[state] ?? state}</span>;
}

/**
 * One colour per sector, the same on the filter chips and on each story's label (user, 18/11/2026).
 * Full class strings (Tailwind keeps only classes written out). The label text always comes with the colour.
 */
export const CAT_STYLE: Record<string, { dot: string; soft: string; solid: string }> = {
  LAND: { dot: 'bg-amber-500', soft: 'border-amber-300 bg-amber-50 text-amber-900', solid: 'border-amber-600 bg-amber-600 text-white' },
  BUILD: { dot: 'bg-orange-500', soft: 'border-orange-300 bg-orange-50 text-orange-900', solid: 'border-orange-600 bg-orange-600 text-white' },
  INFRA: { dot: 'bg-emerald-500', soft: 'border-emerald-300 bg-emerald-50 text-emerald-900', solid: 'border-emerald-600 bg-emerald-600 text-white' },
  TRAFFIC: { dot: 'bg-blue-500', soft: 'border-blue-300 bg-blue-50 text-blue-900', solid: 'border-blue-600 bg-blue-600 text-white' },
  REALESTATE: { dot: 'bg-fuchsia-500', soft: 'border-fuchsia-300 bg-fuchsia-50 text-fuchsia-900', solid: 'border-fuchsia-600 bg-fuchsia-600 text-white' },
  FLOOD: { dot: 'bg-cyan-500', soft: 'border-cyan-300 bg-cyan-50 text-cyan-900', solid: 'border-cyan-600 bg-cyan-600 text-white' },
  INVEST: { dot: 'bg-lime-600', soft: 'border-lime-300 bg-lime-50 text-lime-900', solid: 'border-lime-700 bg-lime-700 text-white' },
  POLICY: { dot: 'bg-slate-500', soft: 'border-slate-300 bg-slate-100 text-slate-800', solid: 'border-slate-700 bg-slate-700 text-white' },
};
export const catStyle = (code: string | null | undefined) => (code && CAT_STYLE[code]) || { dot: 'bg-slate-300', soft: 'border-slate-300 bg-white text-slate-600', solid: 'border-slate-600 bg-slate-600 text-white' };
