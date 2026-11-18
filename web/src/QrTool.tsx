/**
 * "Tạo mã QR": a QR code from any address, made in the browser (no outside service), to save as PNG / SVG or copy
 * straight into PowerPoint. Opened from the header (button "QR"); ESC closes it like the other dialogs.
 */
import { Copy, Download, QrCode, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useEscape, useToast } from './ui';

type Level = 'M' | 'H';
interface Matrix { size: number; get: (x: number, y: number) => boolean }

/** "sxd.hochiminhcity.gov.vn/abc" → "https://sxd.hochiminhcity.gov.vn/abc"; other text is kept as it is */
export function qrTarget(raw: string): { text: string; isUrl: boolean; fixed: boolean } {
  const t = raw.trim();
  if (/^https?:\/\/\S+$/i.test(t)) return { text: t, isUrl: true, fixed: false };
  if (/^(www\.)?[\p{L}\d-]+(\.[\p{L}\d-]+)+(:\d+)?([/?#]\S*)?$/u.test(t)) return { text: `https://${t}`, isUrl: true, fixed: true };
  return { text: t, isUrl: false, fixed: false };
}

const QUIET = 4; // modules of white border required by the QR standard
const SIZES: Array<[number, string]> = [[600, 'Nhỏ – 600 px (màn hình)'], [1200, 'Vừa – 1200 px (slide, khuyên dùng)'], [2400, 'Lớn – 2400 px (in khổ lớn)']];

function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
}

/** draws the code (+ optional caption) on a canvas of `px` width */
function draw(canvas: HTMLCanvasElement, m: Matrix, px: number, color: string, transparent: boolean, caption: string) {
  const n = m.size + QUIET * 2;
  const scale = Math.max(1, Math.floor(px / n));
  const w = n * scale;
  const capH = caption ? Math.round(w * 0.11) : 0;
  canvas.width = w;
  canvas.height = w + capH;
  const g = canvas.getContext('2d')!;
  g.clearRect(0, 0, canvas.width, canvas.height);
  if (!transparent) {
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, canvas.width, canvas.height);
  }
  g.fillStyle = color;
  for (let y = 0; y < m.size; y++) for (let x = 0; x < m.size; x++) if (m.get(x, y)) g.fillRect((x + QUIET) * scale, (y + QUIET) * scale, scale, scale);
  if (caption) {
    let fs = Math.round(capH * 0.55);
    g.font = `600 ${fs}px "Segoe UI", Arial, sans-serif`;
    while (fs > 8 && g.measureText(caption).width > w - 2 * QUIET * scale) g.font = `600 ${--fs}px "Segoe UI", Arial, sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(caption, w / 2, w - QUIET * scale * 0.4 + capH / 2);
  }
}

function svgOf(m: Matrix, color: string, transparent: boolean, caption: string): string {
  const n = m.size + QUIET * 2;
  const capH = caption ? n * 0.11 : 0;
  let d = '';
  for (let y = 0; y < m.size; y++) for (let x = 0; x < m.size; x++) if (m.get(x, y)) d += `M${x + QUIET} ${y + QUIET}h1v1h-1z`;
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n} ${n + capH}" width="${n * 10}" height="${(n + capH) * 10}" shape-rendering="crispEdges">${transparent ? '' : `<rect width="100%" height="100%" fill="#fff"/>`}<path fill="${color}" d="${d}"/>${caption ? `<text x="${n / 2}" y="${n - QUIET * 0.4 + capH / 2}" font-family="Segoe UI, Arial, sans-serif" font-weight="600" font-size="${capH * 0.55}" text-anchor="middle" dominant-baseline="middle" fill="${color}">${esc(caption)}</text>` : ''}</svg>`;
}

/** file name from the address: "qr-sggp.org.vn.png" */
function fileBase(text: string, isUrl: boolean): string {
  if (isUrl) try { return `qr-${new URL(text).hostname.replace(/^www\./, '')}`; } catch { /* fall through */ }
  return 'qr-code';
}

export function QrDialog({ onClose, initial = '' }: { onClose: () => void; initial?: string }) {
  const toast = useToast();
  useEscape(onClose);
  const [raw, setRaw] = useState(initial);
  const [px, setPx] = useState(1200);
  const [level, setLevel] = useState<Level>('M');
  const [color, setColor] = useState('#000000');
  const [transparent, setTransparent] = useState(false);
  const [caption, setCaption] = useState('');
  const [matrix, setMatrix] = useState<Matrix | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const preview = useRef<HTMLCanvasElement>(null);
  const target = useMemo(() => qrTarget(raw), [raw]);
  const lowContrast = luminance(color) > 0.4;

  useEffect(() => {
    let live = true;
    if (!target.text) return setMatrix(null), setErr(null);
    import('qrcode')
      .then((Q) => {
        if (!live) return;
        const q = Q.create(target.text, { errorCorrectionLevel: level });
        setMatrix({ size: q.modules.size, get: (x, y) => !!q.modules.get(y, x) });
        setErr(null);
      })
      .catch((e: Error) => live && (setMatrix(null), setErr(/too big|amount of data/i.test(e.message) ? 'Địa chỉ quá dài để tạo mã QR – hãy rút gọn.' : e.message)));
    return () => {
      live = false;
    };
  }, [target.text, level]);

  useEffect(() => {
    if (matrix && preview.current) draw(preview.current, matrix, 480, color, transparent, caption.trim());
  }, [matrix, color, transparent, caption]);

  const pngBlob = () =>
    new Promise<Blob>((ok, no) => {
      const c = document.createElement('canvas');
      draw(c, matrix!, px, color, transparent, caption.trim());
      c.toBlob((b) => (b ? ok(b) : no(new Error('Không tạo được ảnh'))), 'image/png');
    });
  const save = (blob: Blob, name: string) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };
  const base = fileBase(target.text, target.isUrl);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-3" role="dialog" aria-modal="true" aria-label="Tạo mã QR" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="card max-h-[95vh] w-full max-w-3xl overflow-y-auto p-5" data-testid="qr-dialog">
        <div className="mb-3 flex items-start gap-3">
          <QrCode className="mt-0.5 h-5 w-5 text-teal-600" />
          <div className="flex-1">
            <h2 className="text-lg font-bold text-navy-700">Tạo mã QR</h2>
            <p className="text-xs text-slate-500">Dán địa chỉ bất kỳ, tải ảnh hoặc sao chép rồi dán thẳng vào slide PowerPoint. Mã được tạo ngay trên máy, không gửi địa chỉ đi đâu.</p>
          </div>
          <button className="btn-ghost btn-xs" onClick={onClose} aria-label="Đóng"><X className="h-4 w-4" /></button>
        </div>
        <div className="grid gap-5 sm:grid-cols-[1fr_auto]">
          <div className="space-y-3">
            <label className="block">
              <span className="label">Địa chỉ (URL)</span>
              <input className="input" value={raw} onChange={(e) => setRaw(e.target.value)} placeholder="https://…" autoFocus aria-label="Địa chỉ cần tạo mã QR" data-testid="qr-url" />
              {target.text && (
                <span className={`mt-1 block break-all text-xs ${target.isUrl ? 'text-slate-500' : 'text-amber-700'}`}>
                  {target.isUrl ? <>Quét mã sẽ mở: <b className="text-slate-700">{target.text}</b>{target.fixed ? ' (đã thêm https://)' : ''}</> : 'Không phải địa chỉ web – mã vẫn tạo được, điện thoại sẽ hiện dòng chữ này thay vì mở trang.'}
                </span>
              )}
            </label>
            <label className="block">
              <span className="label">Dòng chữ dưới mã (không bắt buộc)</span>
              <input className="input" value={caption} onChange={(e) => setCaption(e.target.value)} maxLength={60} placeholder="Ví dụ: Quét để đọc bài gốc" aria-label="Dòng chữ dưới mã" />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="label">Kích thước ảnh PNG</span>
                <select className="input" value={px} onChange={(e) => setPx(Number(e.target.value))} aria-label="Kích thước ảnh">
                  {SIZES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </label>
              <label className="block">
                <span className="label">Độ bền mã</span>
                <select className="input" value={level} onChange={(e) => setLevel(e.target.value as Level)} aria-label="Độ bền mã">
                  <option value="M">Thường (mã thưa, dễ quét)</option>
                  <option value="H">Cao (vẫn quét được khi in mờ, bị che một phần)</option>
                </select>
              </label>
            </div>
            <div className="flex flex-wrap items-center gap-4 text-sm">
              <label className="inline-flex items-center gap-2">
                <input type="color" value={color} onChange={(e) => setColor(e.target.value)} aria-label="Màu mã" className="h-7 w-10 cursor-pointer rounded border border-slate-300" />
                Màu mã
              </label>
              <label className="inline-flex items-center gap-2">
                <input type="checkbox" checked={transparent} onChange={(e) => setTransparent(e.target.checked)} />
                Nền trong suốt
              </label>
              {color !== '#000000' && <button className="text-xs text-teal-700 hover:underline" onClick={() => setColor('#000000')}>Về màu đen</button>}
            </div>
            {lowContrast && <p className="rounded bg-amber-50 px-2 py-1 text-xs text-amber-900">Màu quá nhạt – nhiều điện thoại không quét được. Nên dùng màu đậm trên nền sáng.</p>}
            {transparent && <p className="text-xs text-slate-500">Nền trong suốt chỉ quét được khi đặt trên nền sáng của slide.</p>}
          </div>
          <div className="flex flex-col items-center gap-2">
            <div
              className="flex h-60 w-60 items-center justify-center rounded-lg border border-slate-200 p-2"
              style={transparent ? { backgroundImage: 'repeating-conic-gradient(#e2e8f0 0 25%, #fff 0 50%)', backgroundSize: '16px 16px' } : { background: '#fff' }}
            >
              {matrix ? <canvas ref={preview} className="max-h-full max-w-full" data-testid="qr-preview" aria-label={`Mã QR của ${target.text}`} /> : <span className="px-4 text-center text-xs text-slate-400">{err ?? 'Nhập địa chỉ để xem mã QR'}</span>}
            </div>
            {matrix && <span className="text-[11px] text-slate-400">{matrix.size}×{matrix.size} ô · ảnh {px}px</span>}
          </div>
        </div>
        <div className="mt-4 flex flex-wrap justify-end gap-2 border-t border-slate-100 pt-3">
          <button
            className="btn-ghost"
            disabled={!matrix}
            onClick={async () => {
              try {
                await navigator.clipboard.write([new ClipboardItem({ 'image/png': pngBlob() })]);
                toast('ok', 'Đã sao chép ảnh mã QR – vào PowerPoint bấm Ctrl+V để dán');
              } catch {
                toast('err', 'Trình duyệt không cho sao chép ảnh – hãy dùng Tải PNG');
              }
            }}
          >
            <Copy className="h-4 w-4" /> Sao chép ảnh
          </button>
          <button className="btn-ghost" disabled={!matrix} onClick={() => save(new Blob([svgOf(matrix!, color, transparent, caption.trim())], { type: 'image/svg+xml' }), `${base}.svg`)} title="Ảnh vector: phóng to bao nhiêu cũng nét (PowerPoint 365 trở lên)">
            <Download className="h-4 w-4" /> Tải SVG
          </button>
          <button className="btn-primary" disabled={!matrix} onClick={async () => save(await pngBlob(), `${base}.png`)} data-testid="qr-download-png">
            <Download className="h-4 w-4" /> Tải PNG
          </button>
        </div>
      </div>
    </div>
  );
}
