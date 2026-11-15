import { Download, FileUp, History, Plus, RotateCcw, Save, Search, Trash2, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { defaultSettings } from '../../src/domain/defaults';
import { detectLocation } from '../../src/domain/location';
import { SettingsSchema, type LocationArea, type RuleGroup, type Settings, type Source } from '../../src/domain/schemas';
import { formatVn, lastCompletedWindow } from '../../src/domain/timeWindow';
import { uid } from '../../src/domain/text';
import { api, type HistoryEntry, type PreviewResult } from './api';
import { RuleBuilder } from './RuleBuilder';
import { SourcesPanel } from './SourcesPanel';
import { ChipEditor, Field, NumberField, Section, Select, Toggle, useToast } from './ui';

const NAV = [
  ['sources', 'Nguồn tin'],
  ['rules', 'Từ khóa & quy tắc'],
  ['location', 'Địa điểm'],
  ['categories', 'Lĩnh vực'],
  ['time', 'Thời gian'],
  ['quality', 'Chất lượng thu thập & ảnh'],
  ['report', 'Báo cáo & mẫu'],
  ['performance', 'Hiệu năng'],
  ['backup', 'Sao lưu & lịch sử'],
] as const;
type NavKey = (typeof NAV)[number][0];

export function SettingsDrawer({ open, onClose, onSaved, initialSection }: { open: boolean; onClose: () => void; onSaved: (s: Settings, src: Source[]) => void; initialSection?: NavKey }) {
  const toast = useToast();
  const [saved, setSaved] = useState<{ s: Settings; src: Source[] } | null>(null);
  const [s, setS] = useState<Settings | null>(null);
  const [src, setSrc] = useState<Source[]>([]);
  const [nav, setNav] = useState<NavKey>(initialSection ?? 'sources');
  const [filter, setFilter] = useState('');
  const [saving, setSaving] = useState(false);

  const load = async () => {
    const [a, b] = await Promise.all([api.getSettings(), api.getSources()]);
    setSaved({ s: a, src: b });
    setS(structuredClone(a));
    setSrc(structuredClone(b));
  };
  useEffect(() => {
    if (open) load().catch((e) => toast('err', e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  useEffect(() => {
    if (initialSection) setNav(initialSection);
  }, [initialSection]);

  const dirtyS = !!s && !!saved && JSON.stringify(s) !== JSON.stringify(saved.s);
  const dirtySrc = !!saved && JSON.stringify(src) !== JSON.stringify(saved.src);
  const validation = useMemo(() => (s ? SettingsSchema.safeParse(s) : null), [s]);
  if (!open) return null;

  const close = () => {
    if ((dirtyS || dirtySrc) && !confirm('Có thay đổi chưa lưu. Đóng và bỏ thay đổi?')) return;
    onClose();
  };
  const save = async () => {
    if (!s) return;
    setSaving(true);
    try {
      let ns = saved!.s;
      let nsrc = saved!.src;
      if (dirtyS) ns = await api.saveSettings(s, `Cập nhật mục ${NAV.find((n) => n[0] === nav)?.[1]}`);
      if (dirtySrc) nsrc = await api.saveSources(src, 'Cập nhật nguồn tin');
      setSaved({ s: ns, src: nsrc });
      setS(structuredClone(ns));
      setSrc(structuredClone(nsrc));
      onSaved(ns, nsrc);
      toast('ok', 'Đã lưu cài đặt');
    } catch (e) {
      toast('err', `Không lưu được: ${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  };
  const up = <K extends keyof Settings>(k: K, v: Partial<Settings[K]>) => setS((p) => (p ? { ...p, [k]: Array.isArray(p[k]) ? v : { ...(p[k] as object), ...v } } : p));
  const resetSection = () => {
    const d = defaultSettings();
    const map: Partial<Record<NavKey, Array<keyof Settings>>> = {
      rules: ['keywords', 'rules'], location: ['location'], categories: ['categories'], time: ['reportWindow', 'startup'],
      quality: ['quality', 'discovery', 'editorial'], report: ['report'], performance: ['collection', 'performance'],
    };
    const keys = map[nav];
    if (!keys || !s || !confirm('Đặt lại mục này về mặc định? (Chưa lưu cho tới khi bấm Lưu)')) return;
    setS({ ...s, ...Object.fromEntries(keys.map((k) => [k, d[k]])) });
  };

  const navItems = NAV.filter(([, l]) => !filter || l.toLowerCase().includes(filter.toLowerCase()) || SEARCH_INDEX[NAV.find((n) => n[1] === l)![0]]?.some((w) => w.includes(filter.toLowerCase())));

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-900/30" role="dialog" aria-modal="true" aria-label="Cài đặt">
      <div className="flex h-full w-full max-w-[1100px] flex-col bg-slate-50 shadow-2xl">
        <header className="flex items-center gap-3 border-b border-slate-200 bg-white px-4 py-3">
          <h2 className="text-lg font-bold text-navy-700">Cài đặt</h2>
          {(dirtyS || dirtySrc) && <span className="chip border-amber-300 bg-amber-50 text-amber-800">Chưa lưu</span>}
          <span className="flex-1" />
          <button className="btn-ghost" onClick={resetSection} disabled={nav === 'sources' || nav === 'backup'}>
            <RotateCcw className="h-4 w-4" /> Mặc định mục này
          </button>
          <button className="btn-ghost" disabled={!(dirtyS || dirtySrc)} onClick={() => saved && (setS(structuredClone(saved.s)), setSrc(structuredClone(saved.src)))}>
            Hủy thay đổi
          </button>
          <button className="btn-primary" disabled={!(dirtyS || dirtySrc) || saving || (validation ? !validation.success : true)} onClick={save}>
            <Save className="h-4 w-4" /> {saving ? 'Đang lưu…' : 'Lưu'}
          </button>
          <button className="btn-ghost" onClick={close} aria-label="Đóng cài đặt">
            <X className="h-4 w-4" />
          </button>
        </header>
        {validation && !validation.success && (
          <div className="border-b border-red-200 bg-red-50 px-4 py-2 text-xs text-red-800">
            {validation.error.issues.slice(0, 5).map((i) => (
              <div key={i.path.join('.')}>{i.path.join(' › ')}: {i.message}</div>
            ))}
          </div>
        )}
        <div className="flex min-h-0 flex-1">
          <nav className="w-56 shrink-0 overflow-auto border-r border-slate-200 bg-white p-2">
            <div className="relative mb-2">
              <Search className="absolute left-2 top-2 h-3.5 w-3.5 text-slate-400" />
              <input className="input pl-7 text-xs" placeholder="Tìm cài đặt…" value={filter} onChange={(e) => setFilter(e.target.value)} />
            </div>
            {navItems.map(([k, l]) => (
              <button key={k} onClick={() => setNav(k)} className={`mb-0.5 block w-full rounded px-2 py-1.5 text-left text-sm ${nav === k ? 'bg-navy-700 text-white' : 'hover:bg-slate-100'}`}>
                {l}
              </button>
            ))}
          </nav>
          <main className="min-w-0 flex-1 overflow-auto p-4">
            {!s ? (
              <p>Đang tải…</p>
            ) : nav === 'sources' ? (
              <SourcesPanel sources={src} setSources={setSrc} />
            ) : nav === 'rules' ? (
              <RulesPanel s={s} setS={setS} sources={src} />
            ) : nav === 'location' ? (
              <LocationPanel s={s} up={up} />
            ) : nav === 'categories' ? (
              <CategoriesPanel s={s} setS={setS} />
            ) : nav === 'time' ? (
              <TimePanel s={s} up={up} />
            ) : nav === 'quality' ? (
              <QualityPanel s={s} up={up} />
            ) : nav === 'report' ? (
              <ReportPanel s={s} up={up} />
            ) : nav === 'performance' ? (
              <PerfPanel s={s} up={up} />
            ) : (
              <BackupPanel onRestored={load} />
            )}
          </main>
        </div>
      </div>
    </div>
  );
}

const SEARCH_INDEX: Record<string, string[]> = {
  sources: ['rss', 'sitemap', 'chuyên mục', 'báo', 'website', 'phân trang', 'độ sâu'],
  rules: ['từ khóa', 'đồng nghĩa', 'and', 'or', 'not', 'loại trừ', 'quy tắc'],
  location: ['phường', 'xã', 'tp.hcm', 'địa bàn', 'bí danh', 'tỉnh'],
  categories: ['lĩnh vực', 'phân loại', 'đất đai', 'giao thông'],
  time: ['giờ', 'khung', '17:00', '08:00', 'tự động'],
  quality: ['ảnh', 'bảng', 'chú thích', 'ngưỡng', 'bóc tách', 'bản quyền'],
  report: ['pptx', 'pdf', 'mẫu', 'libreoffice', 'tên tệp'],
  performance: ['đồng thời', 'timeout', 'thử lại', 'cache', 'robots'],
  backup: ['khôi phục', 'sao lưu', 'lịch sử', 'nhập', 'xuất'],
};

type Up = <K extends keyof Settings>(k: K, v: Partial<Settings[K]>) => void;

/* ---------------- Rules ---------------- */
function RulesPanel({ s, setS, sources }: { s: Settings; setS: (fn: (p: Settings | null) => Settings | null) => void; sources: Source[] }) {
  const toast = useToast();
  const preset = s.rules.presets.find((p) => p.id === s.rules.activePresetId) ?? s.rules.presets[0];
  const [sample, setSample] = useState({ title: 'Mưa lớn khiến đường ở phường Hiệp Bình ngập sâu', body: '' });
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const setKw = (p: Partial<Settings['keywords']>) => setS((x) => (x ? { ...x, keywords: { ...x.keywords, ...p } } : x));
  const setPreset = (patch: Partial<NonNullable<typeof preset>>) =>
    setS((x) => (x ? { ...x, rules: { ...x.rules, presets: x.rules.presets.map((p) => (p.id === preset?.id ? { ...p, ...patch } : p)) } } : x));
  const addPreset = () => {
    const id = uid('preset');
    setS((x) => (x ? { ...x, rules: { ...x.rules, activePresetId: id, presets: [...x.rules.presets, { id, name: 'Bộ quy tắc mới', sourceIds: [], root: { kind: 'group', id: uid('g'), op: 'AND', negate: false, children: [] } }] } } : x));
  };
  const run = async () => {
    if (!preset) return;
    try {
      setPreview(await api.previewRule(preset.root, s, sample));
    } catch (e) {
      toast('err', (e as Error).message);
    }
  };
  return (
    <div>
      <Section title="Từ khóa ngành" help="Danh sách tham khảo dùng để gợi ý; quy tắc chính nằm ở Bộ quy tắc bên dưới">
        <ChipEditor values={s.keywords.topicKeywords} onChange={(v) => setKw({ topicKeywords: v })} label="Từ khóa chủ đề" />
        <ChipEditor values={s.keywords.excludePhrases} onChange={(v) => setKw({ excludePhrases: v })} label="Cụm loại trừ trong tiêu đề" help="Bài có cụm này trong tiêu đề bị đánh dấu Không liên quan (vẫn hiện trong Sổ ứng viên kèm lý do)" />
        <ChipEditor values={s.keywords.excludeUrlSections} onChange={(v) => setKw({ excludeUrlSections: v })} label="Chuyên mục URL loại trừ" help="Ví dụ the-thao, giai-tri" validate={(v) => (/^[a-z0-9-]+$/.test(v) ? null : 'Chỉ a-z, 0-9, dấu gạch')} />
      </Section>
      <Section title="Nhóm từ đồng nghĩa" actions={<button className="btn-ghost btn-xs" onClick={() => setKw({ synonyms: [...s.keywords.synonyms, { canonical: 'từ mới', aliases: [] }] })}><Plus className="h-3 w-3" /> Thêm nhóm</button>}>
        {s.keywords.synonyms.map((g, i) => (
          <div key={i} className="flex items-start gap-2">
            <input className="input w-40" value={g.canonical} onChange={(e) => setKw({ synonyms: s.keywords.synonyms.map((x, j) => (j === i ? { ...x, canonical: e.target.value } : x)) })} aria-label="Từ chuẩn" />
            <div className="flex-1"><ChipEditor values={g.aliases} onChange={(v) => setKw({ synonyms: s.keywords.synonyms.map((x, j) => (j === i ? { ...x, aliases: v } : x)) })} placeholder="đồng nghĩa…" /></div>
            <button className="btn-danger btn-xs" onClick={() => setKw({ synonyms: s.keywords.synonyms.filter((_, j) => j !== i) })} aria-label="Xóa nhóm"><Trash2 className="h-3 w-3" /></button>
          </div>
        ))}
      </Section>
      <Section title="Bộ quy tắc AND / OR / NOT" actions={<button className="btn-ghost btn-xs" onClick={addPreset}><Plus className="h-3 w-3" /> Bộ mới</button>}>
        <div className="grid gap-3 md:grid-cols-3">
          <Select label="Bộ quy tắc đang dùng" value={s.rules.activePresetId} onChange={(v) => setS((x) => (x ? { ...x, rules: { ...x.rules, activePresetId: v } } : x))} options={s.rules.presets.map((p) => [p.id, p.name])} />
          {preset && (
            <Field label="Tên bộ quy tắc">
              <input className="input" value={preset.name} onChange={(e) => setPreset({ name: e.target.value })} />
            </Field>
          )}
          <Select label="Khi không khớp quy tắc nhưng đúng địa bàn" value={s.rules.unknownRelevancePolicy} onChange={(v) => setS((x) => (x ? { ...x, rules: { ...x.rules, unknownRelevancePolicy: v } } : x))} options={[['review', 'Đưa vào hàng Cần kiểm tra'], ['exclude_with_reason', 'Loại kèm lý do']]} />
        </div>
        {preset && (
          <>
            <div>
              <span className="label">Áp dụng riêng cho nguồn (để trống = mọi nguồn)</span>
              <div className="flex flex-wrap gap-2">
                {sources.map((x) => (
                  <label key={x.id} className="flex items-center gap-1 text-xs">
                    <input type="checkbox" checked={preset.sourceIds.includes(x.id)} onChange={(e) => setPreset({ sourceIds: e.target.checked ? [...preset.sourceIds, x.id] : preset.sourceIds.filter((y) => y !== x.id) })} /> {x.name}
                  </label>
                ))}
              </div>
            </div>
            <RuleBuilder root={preset.root as RuleGroup} onChange={(root) => setPreset({ root })} />
            {s.rules.presets.length > 1 && (
              <button className="btn-danger btn-xs" onClick={() => confirm('Xóa bộ quy tắc này?') && setS((x) => (x ? { ...x, rules: { ...x.rules, presets: x.rules.presets.filter((p) => p.id !== preset.id), activePresetId: x.rules.presets.find((p) => p.id !== preset.id)!.id } } : x))}>
                Xóa bộ quy tắc
              </button>
            )}
          </>
        )}
      </Section>
      <Section title="Xem thử kết quả (chưa lưu vẫn thử được)">
        <Field label="Tiêu đề thử">
          <input className="input" value={sample.title} onChange={(e) => setSample({ ...sample, title: e.target.value })} />
        </Field>
        <Field label="Nội dung thử (tùy chọn)">
          <textarea className="input" rows={2} value={sample.body} onChange={(e) => setSample({ ...sample, body: e.target.value })} />
        </Field>
        <button className="btn-teal" onClick={run}>Xem thử trên bài mẫu + bài đã thu thập</button>
        {preview && (
          <div className="text-xs">
            {preview.errors.length > 0 && <div className="mb-2 rounded bg-red-50 p-2 text-red-800">{preview.errors.join('; ')}</div>}
            <p className="mb-1">
              Khớp <b>{preview.results.filter((r) => r.matched).length}</b> / {preview.results.length} bài
            </p>
            <div className="max-h-80 space-y-1 overflow-auto">
              {preview.results.map((r) => (
                <details key={r.id} className={`rounded border p-1.5 ${r.matched ? 'border-green-200 bg-green-50' : 'border-slate-200 bg-white'}`}>
                  <summary className="cursor-pointer">
                    {r.matched ? '✔ Khớp' : '✘ Không khớp'} – {r.title} {r.location && <span className="text-slate-500">[địa bàn: {r.location}]</span>}
                  </summary>
                  <pre className="whitespace-pre-wrap text-[11px] text-slate-700">{r.lines.slice(0, 60).join('\n')}</pre>
                </details>
              ))}
            </div>
          </div>
        )}
      </Section>
    </div>
  );
}

/* ---------------- Location ---------------- */
const KIND_LABEL: Record<LocationArea['kind'], string> = {
  city: 'Thành phố', ward: 'Phường', commune: 'Xã', special_zone: 'Đặc khu', landmark: 'Địa danh/công trình', legacy_district: 'Quận/huyện cũ', custom: 'Tùy chỉnh', connected_area: 'Liên vùng (cần kiểm tra)',
};
function LocationPanel({ s, up }: { s: Settings; up: Up }) {
  const [q, setQ] = useState('');
  const [kind, setKind] = useState<string>('all');
  const [test, setTest] = useState('Kẹt xe kéo dài trên đường Phạm Văn Đồng');
  const areas = s.location.areas;
  const shown = areas.filter((a) => (kind === 'all' || a.kind === kind) && (!q || [a.name, ...a.aliases].some((x) => x.toLowerCase().includes(q.toLowerCase()))));
  const setAreas = (list: LocationArea[]) => up('location', { areas: list });
  const r = detectLocation(test, '', s.location);
  return (
    <div>
      <Section title="Kiểm tra nhanh">
        <input className="input" value={test} onChange={(e) => setTest(e.target.value)} aria-label="Câu thử địa bàn" />
        <p className="text-xs">
          Kết quả: <b>{r.status === 'hcm' ? 'TP.HCM' : r.status === 'connected' ? 'Liên vùng – cần kiểm tra' : r.status === 'other_province' ? 'Địa phương khác' : 'Chưa rõ – vào hàng Cần kiểm tra'}</b>
          <br />
          {r.evidence.join(' · ')}
        </p>
      </Section>
      <Section title="Quy tắc địa bàn">
        <Toggle checked={s.location.requireHcmEvidence} onChange={(v) => up('location', { requireHcmEvidence: v })} label="Bắt buộc có bằng chứng địa bàn TP.HCM để vào nhóm sẵn sàng (không có → Cần kiểm tra, không bị bỏ)" />
        <Toggle checked={s.location.connectedAreasForReview} onChange={(v) => up('location', { connectedAreasForReview: v })} label="Dự án liên vùng (Vành đai 3, Long Thành…) đưa vào Cần kiểm tra" />
        <ChipEditor values={s.location.otherProvinces} onChange={(v) => up('location', { otherProvinces: v })} label="Địa phương khác (nêu trong tiêu đề mà không có bằng chứng TP.HCM → loại kèm lý do)" />
      </Section>
      <Section
        title={`Địa danh & bí danh (${areas.length})`}
        help="Nguồn: danh sách đơn vị hành chính trong Skill (NQ 1685/NQ-UBTVQH15). Tên dễ nhầm cần tiền tố phường/xã."
        actions={<button className="btn-ghost btn-xs" onClick={() => setAreas([{ id: uid('loc'), name: 'Địa danh mới', kind: 'custom', aliases: [], requirePrefix: false }, ...areas])}><Plus className="h-3 w-3" /> Thêm địa danh</button>}
      >
        <div className="flex gap-2">
          <input className="input" placeholder="Tìm tên/bí danh…" value={q} onChange={(e) => setQ(e.target.value)} />
          <select className="input w-56" value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Loại">
            <option value="all">Tất cả loại</option>
            {Object.entries(KIND_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </div>
        <div className="max-h-[55vh] space-y-1 overflow-auto">
          {shown.slice(0, 150).map((a) => (
            <div key={a.id} className="flex flex-wrap items-start gap-2 rounded border border-slate-200 bg-white p-1.5">
              <input className="input w-44" value={a.name} onChange={(e) => setAreas(areas.map((x) => (x.id === a.id ? { ...x, name: e.target.value } : x)))} aria-label="Tên" />
              <select className="input w-40" value={a.kind} onChange={(e) => setAreas(areas.map((x) => (x.id === a.id ? { ...x, kind: e.target.value as LocationArea['kind'] } : x)))} aria-label="Loại địa danh">
                {Object.entries(KIND_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
              <div className="min-w-[14rem] flex-1"><ChipEditor values={a.aliases} onChange={(v) => setAreas(areas.map((x) => (x.id === a.id ? { ...x, aliases: v } : x)))} placeholder="bí danh / tên cũ…" /></div>
              {(a.kind === 'ward' || a.kind === 'commune') && <Toggle checked={a.requirePrefix} onChange={(v) => setAreas(areas.map((x) => (x.id === a.id ? { ...x, requirePrefix: v } : x)))} label="cần tiền tố" />}
              <button className="btn-danger btn-xs" onClick={() => setAreas(areas.filter((x) => x.id !== a.id))} aria-label={`Xóa ${a.name}`}><Trash2 className="h-3 w-3" /></button>
            </div>
          ))}
          {shown.length > 150 && <p className="text-xs text-slate-500">Hiển thị 150/{shown.length} – dùng ô tìm để lọc.</p>}
        </div>
      </Section>
    </div>
  );
}

/* ---------------- Categories ---------------- */
function CategoriesPanel({ s, setS }: { s: Settings; setS: (fn: (p: Settings | null) => Settings | null) => void }) {
  const set = (code: string, p: Partial<Settings['categories'][number]>) => setS((x) => (x ? { ...x, categories: x.categories.map((c) => (c.code === code ? { ...c, ...p } : c)) } : x));
  return (
    <Section title="Lĩnh vực chuyên môn" help="Chỉ là gợi ý phân loại theo từ khóa; biên tập viên luôn có thể đổi. Tính chất tin (Tồn tại/Tích cực/Trung lập) được phân loại độc lập.">
      {[...s.categories].sort((a, b) => a.priority - b.priority).map((c) => (
        <div key={c.code} className="grid gap-2 rounded border border-slate-200 bg-white p-2 md:grid-cols-[auto_12rem_6rem_1fr]">
          <Toggle checked={c.enabled} onChange={(v) => set(c.code, { enabled: v })} label={c.code} />
          <input className="input" value={c.label} onChange={(e) => set(c.code, { label: e.target.value })} aria-label="Tên lĩnh vực" />
          <input className="input" type="number" min={1} max={99} value={c.priority} onChange={(e) => set(c.code, { priority: e.target.valueAsNumber })} aria-label="Ưu tiên" />
          <ChipEditor values={c.keywords} onChange={(v) => set(c.code, { keywords: v })} placeholder="từ khóa lĩnh vực…" />
        </div>
      ))}
    </Section>
  );
}

/* ---------------- Time ---------------- */
function TimePanel({ s, up }: { s: Settings; up: Up }) {
  let preview = '';
  try {
    const w = lastCompletedWindow(new Date(), s.reportWindow.startClock, s.reportWindow.endClock);
    preview = `Kỳ gần nhất: từ ${formatVn(w.from)} (gồm) đến trước ${formatVn(w.to)} (không gồm) – giờ Việt Nam (Asia/Ho_Chi_Minh)`;
  } catch (e) {
    preview = (e as Error).message;
  }
  return (
    <div>
      <Section title="Khung giờ báo cáo mặc định">
        <div className="grid gap-3 md:grid-cols-3">
          <Field label="Giờ bắt đầu (hôm trước)"><input className="input" type="time" value={s.reportWindow.startClock} onChange={(e) => up('reportWindow', { startClock: e.target.value })} /></Field>
          <Field label="Giờ kết thúc (ngày báo cáo)"><input className="input" type="time" value={s.reportWindow.endClock} onChange={(e) => up('reportWindow', { endClock: e.target.value })} /></Field>
          <Select label="Khung mặc định khi mở ứng dụng" value={s.reportWindow.defaultPreset} onChange={(v) => up('reportWindow', { defaultPreset: v })} options={[['last_completed', 'Kỳ gần nhất (đã kết thúc)'], ['today', 'Hôm nay'], ['yesterday', 'Hôm qua'], ['custom', 'Tùy chỉnh đã lưu']]} />
        </div>
        <p className="rounded bg-teal-50 p-2 text-xs text-teal-900">{preview}</p>
        <NumberField label="Biên dò thêm quanh khung giờ" value={s.reportWindow.lookbackMarginHours} min={0} max={72} suffix="giờ" onChange={(n) => up('reportWindow', { lookbackMarginHours: n })} help="Bài có ngày RSS nằm ngoài khung ± biên này được ghi nhận Ngoài khung mà không tải. Bài trong biên vẫn được tải để xác minh giờ đăng thật." />
        <p className="text-xs text-slate-600">Ngày dùng để lọc: <b>giờ đăng gốc</b> (không thay bằng giờ cập nhật hay giờ thu thập). Múi giờ cố định: Asia/Ho_Chi_Minh (UTC+07:00).</p>
      </Section>
      <Section title="Tự động khi mở ứng dụng">
        <Toggle checked={s.startup.autoCollectLastCompletedWindow} onChange={(v) => up('startup', { autoCollectLastCompletedWindow: v })} label="Tự thu thập kỳ gần nhất khi mở ứng dụng (cần Internet)" />
        <Toggle checked={s.startup.oncePerWindow} onChange={(v) => up('startup', { oncePerWindow: v })} label="Mỗi khung giờ chỉ tự chạy một lần (tải lại trang không tạo lượt trùng)" />
      </Section>
    </div>
  );
}

/* ---------------- Quality & images ---------------- */
function QualityPanel({ s, up }: { s: Settings; up: Up }) {
  return (
    <div>
      <Section title="Kênh dò link (toàn cục)">
        {(['rss', 'sitemap', 'section', 'search'] as const).map((m) => (
          <Toggle key={m} checked={s.discovery.enabledMethods.includes(m)} onChange={(v) => up('discovery', { enabledMethods: v ? [...s.discovery.enabledMethods, m] : s.discovery.enabledMethods.filter((x) => x !== m) })} label={{ rss: 'RSS/Atom', sitemap: 'Sitemap', section: 'Trang chuyên mục + phân trang', search: 'Tìm kiếm của báo' }[m]} />
        ))}
        <Toggle checked={s.discovery.showIncompleteWarnings} onChange={(v) => up('discovery', { showIncompleteWarnings: v })} label="Hiện cảnh báo khi chạm giới hạn quét (chưa quét hết)" />
      </Section>
      <Section title="Kiểm tra độ đầy đủ khi bóc tách" help="Không bao giờ coi là đầy đủ 100% chỉ dựa vào độ dài; các cảnh báo dưới đây đưa bài vào hàng Bóc tách thiếu để người duyệt xem">
        <NumberField label="Số ký tự nội dung tối thiểu" value={s.quality.minBodyChars} min={0} max={20000} step={50} onChange={(n) => up('quality', { minBodyChars: n })} />
        <NumberField label="Số đoạn tối thiểu" value={s.quality.minParagraphs} min={0} max={100} onChange={(n) => up('quality', { minParagraphs: n })} />
        <NumberField label="Ngưỡng lệch so với articleBody (JSON-LD)" value={Math.round(s.quality.jsonLdMismatchRatio * 100)} min={0} max={100} suffix="%" onChange={(n) => up('quality', { jsonLdMismatchRatio: n / 100 })} />
        <Toggle checked={s.quality.flagMissingTables} onChange={(v) => up('quality', { flagMissingTables: v })} label="Cảnh báo bảng biểu chưa trích được" />
        <Toggle checked={s.quality.flagMissingCaptions} onChange={(v) => up('quality', { flagMissingCaptions: v })} label="Cảnh báo ảnh thiếu chú thích" />
        <Toggle checked={s.quality.flagPagination} onChange={(v) => up('quality', { flagPagination: v })} label="Phát hiện bài nhiều trang / đọc tiếp" />
        <Toggle checked disabled onChange={() => {}} label="Bài không xác minh được giờ đăng luôn vào hàng Cần kiểm tra (bắt buộc)" />
      </Section>
      <Section title="Ảnh báo gốc">
        <Toggle checked disabled onChange={() => {}} label="Chỉ dùng ảnh thật từ bài báo gốc – không bao giờ dùng ảnh AI (bắt buộc)" />
        <Select label="Chính sách dùng ảnh" value={s.editorial.photoPolicy} onChange={(v) => up('editorial', { photoPolicy: v })} options={[['review_then_use', 'Người duyệt chọn ảnh, ghi nguồn'], ['strict_verified_only', 'Chỉ ảnh đã xác minh quyền sử dụng'], ['link_only', 'Không nhúng ảnh, chỉ dẫn link bài gốc']]} />
        <Select label="Khi không có ảnh dùng được" value={s.editorial.noImagePolicy} onChange={(v) => up('editorial', { noImagePolicy: v })} options={[['text_only', 'Dùng bố cục chỉ có chữ'], ['block_slide', 'Chặn xuất, yêu cầu xử lý']]} />
        <NumberField label="Số ảnh ứng viên tối đa mỗi bài" value={s.editorial.maxImagesPerArticle} min={0} max={5} onChange={(n) => up('editorial', { maxImagesPerArticle: n })} />
        <NumberField label="Chiều rộng ảnh tối thiểu" value={s.editorial.minImageWidth} min={100} max={4000} step={50} suffix="px" onChange={(n) => up('editorial', { minImageWidth: n })} />
      </Section>
      <Section title="Độ dài tóm tắt (cảnh báo tràn khung)">
        <div className="grid gap-3 md:grid-cols-3">
          <NumberField label="Tồn tại" value={s.editorial.summaryMaxChars.TT} min={80} max={800} onChange={(n) => up('editorial', { summaryMaxChars: { ...s.editorial.summaryMaxChars, TT: n } })} />
          <NumberField label="Tích cực" value={s.editorial.summaryMaxChars.TC} min={80} max={800} onChange={(n) => up('editorial', { summaryMaxChars: { ...s.editorial.summaryMaxChars, TC: n } })} />
          <NumberField label="Trung lập" value={s.editorial.summaryMaxChars.TL} min={80} max={800} onChange={(n) => up('editorial', { summaryMaxChars: { ...s.editorial.summaryMaxChars, TL: n } })} />
        </div>
      </Section>
    </div>
  );
}

/* ---------------- Report ---------------- */
function ReportPanel({ s, up }: { s: Settings; up: Up }) {
  const toast = useToast();
  const [caps, setCaps] = useState<{ pdf: boolean; soffice: string | null; powerpoint?: string | null } | null>(null);
  useEffect(() => {
    api.capabilities().then(setCaps).catch(() => setCaps(null));
  }, []);
  const upload = async (f: File) => {
    if (!f.name.toLowerCase().endsWith('.pptx')) return toast('err', 'Chỉ nhận tệp .pptx');
    const buf = new Uint8Array(await f.arrayBuffer());
    let bin = '';
    for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    try {
      const r = await api.uploadTemplate(f.name, btoa(bin));
      up('report', { templateFile: r.templateFile });
      toast('ok', `Đã lưu bản sao mẫu: ${r.templateFile} (tệp gốc của bạn không bị sửa)`);
    } catch (e) {
      toast('err', (e as Error).message);
    }
  };
  return (
    <div>
      {s.report.templateFile ? (
        <div className="mb-4 rounded border border-green-300 bg-green-50 p-3 text-xs text-green-900">
          <b>Đang dùng mẫu PPTX gốc:</b> báo cáo được dựng bằng cách nhân bản đúng các trang của mẫu (Bìa → Tồn tại → Tích cực → Trung lập → Kiến nghị), thay nội dung trong các khung sẵn có và giữ nguyên định dạng. Nếu tải mẫu khác cấu trúc, xuất báo cáo sẽ báo <b>BLOCKED</b> thay vì tạo tệp sai.
        </div>
      ) : (
        <div className="mb-4 rounded border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
          <b>Chưa có mẫu PPTX gốc:</b> báo cáo sẽ dùng bố cục <b>DEMO</b> (mỗi trang có nhãn "BẢN DEMO"). Tải tệp mẫu của Sở ở bên dưới để xuất đúng mẫu.
        </div>
      )}
      <Section title="Mẫu PowerPoint">
        <p className="text-xs">Tệp mẫu đang chọn: <b>{s.report.templateFile || '(chưa có – dùng bố cục demo)'}</b></p>
        <label className="btn-ghost w-fit cursor-pointer">
          <FileUp className="h-4 w-4" /> Tải mẫu .pptx
          <input type="file" accept=".pptx" className="hidden" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
        </label>
        <Field label="Tên cơ quan trên bìa"><input className="input" value={s.report.organization} onChange={(e) => up('report', { organization: e.target.value })} /></Field>
        <Field label="Email phúc đáp (trang Kiến nghị)"><input className="input" value={s.report.contactEmail} onChange={(e) => up('report', { contactEmail: e.target.value })} /></Field>
        <NumberField label="Số tin mỗi trang" value={s.report.storiesPerPage} min={1} max={4} onChange={(n) => up('report', { storiesPerPage: n })} />
        <Select label="Khi nội dung quá dài" value={s.report.overflowPolicy} onChange={(v) => up('report', { overflowPolicy: v })} options={[['new_slide', 'Thêm trang cùng loại'], ['warn_only', 'Chỉ cảnh báo, người duyệt rút gọn']]} />
      </Section>
      <Section title="Xuất tệp">
        <div className="flex gap-4">
          {(['pptx', 'pdf'] as const).map((f) => (
            <label key={f} className="flex items-center gap-1 text-sm"><input type="checkbox" checked={s.report.outputFormats.includes(f)} onChange={(e) => up('report', { outputFormats: e.target.checked ? [...s.report.outputFormats, f] : s.report.outputFormats.filter((x) => x !== f) })} /> .{f}</label>
          ))}
        </div>
        <Field label="Mẫu tên tệp" help="{date} = ngày báo cáo, {from}/{to} = giờ khung (HHmm)" error={!s.report.filenamePattern.includes('{date}') ? 'Nên có {date} để tránh trùng tên' : null}>
          <input className="input font-mono text-xs" value={s.report.filenamePattern} onChange={(e) => up('report', { filenamePattern: e.target.value })} />
        </Field>
        <Select label="Bộ chuyển PDF" value={s.report.pdfRenderer} onChange={(v) => up('report', { pdfRenderer: v })} options={[['auto', 'Tự động: Microsoft PowerPoint, nếu không có thì LibreOffice'], ['powerpoint', 'Chỉ Microsoft PowerPoint'], ['libreoffice', 'Chỉ LibreOffice'], ['none', 'Không xuất PDF']]} help="PowerPoint cho kết quả giống hệt khi mở bằng Office; ứng dụng mở tệp ở chế độ chỉ đọc, không đóng các bản trình chiếu khác của bạn." />
        <Field label="Đường dẫn POWERPNT.EXE (tùy chọn)"><input className="input font-mono text-xs" placeholder="C:\Program Files (x86)\Microsoft Office\root\Office16\POWERPNT.EXE" value={s.report.powerPointPath} onChange={(e) => up('report', { powerPointPath: e.target.value })} /></Field>
        <Field label="Đường dẫn soffice.exe (tùy chọn)"><input className="input font-mono text-xs" placeholder="C:\Program Files\LibreOffice\program\soffice.exe" value={s.report.libreOfficePath} onChange={(e) => up('report', { libreOfficePath: e.target.value })} /></Field>
        <p className="text-xs">
          {caps
            ? caps.pdf
              ? [caps.powerpoint && `Microsoft PowerPoint: ${caps.powerpoint}`, caps.soffice && `LibreOffice: ${caps.soffice}`].filter(Boolean).join(' · ')
              : 'Chưa tìm thấy PowerPoint hay LibreOffice – xuất PDF sẽ báo không khả dụng.'
            : 'Không kiểm tra được bộ chuyển PDF.'}
        </p>
      </Section>
    </div>
  );
}

/* ---------------- Performance ---------------- */
function PerfPanel({ s, up }: { s: Settings; up: Up }) {
  return (
    <Section title="Mạng & hiệu năng">
      <NumberField label="Tổng yêu cầu đồng thời" value={s.collection.maxConcurrentRequests} min={1} max={16} onChange={(n) => up('collection', { maxConcurrentRequests: n })} />
      <NumberField label="Yêu cầu đồng thời mỗi báo" value={s.collection.maxRequestsPerHost} min={1} max={8} onChange={(n) => up('collection', { maxRequestsPerHost: n })} help="Giữ 1–2 để lịch sự với máy chủ báo" />
      {s.collection.maxRequestsPerHost > 3 && <p className="text-xs text-amber-700">Cảnh báo: nhiều kết nối/báo có thể khiến báo chặn IP.</p>}
      <NumberField label="Thời gian chờ mỗi yêu cầu" value={s.collection.timeoutMs} min={2000} max={120000} step={1000} suffix="ms" onChange={(n) => up('collection', { timeoutMs: n })} />
      <NumberField label="Số lần thử lại" value={s.collection.maxRetries} min={0} max={6} onChange={(n) => up('collection', { maxRetries: n })} />
      <NumberField label="Độ trễ thử lại cơ sở (lũy thừa + ngẫu nhiên)" value={s.collection.backoffBaseMs} min={100} max={30000} step={100} suffix="ms" onChange={(n) => up('collection', { backoffBaseMs: n })} />
      <Field label="User-Agent"><input className="input font-mono text-xs" value={s.collection.userAgent} onChange={(e) => up('collection', { userAgent: e.target.value })} /></Field>
      <Toggle checked={s.collection.respectRobotsTxt} onChange={(v) => up('collection', { respectRobotsTxt: v })} label="Tôn trọng robots.txt và điều khoản của báo (không vượt chặn/paywall/CAPTCHA)" />
      <NumberField label="Bộ nhớ đệm HTTP" value={s.performance.httpCacheMinutes} min={0} max={1440} suffix="phút" onChange={(n) => up('performance', { httpCacheMinutes: n })} />
      <NumberField label="Giữ dữ liệu lượt chạy" value={s.performance.keepRunsDays} min={1} max={3650} suffix="ngày" onChange={(n) => up('performance', { keepRunsDays: n })} />
    </Section>
  );
}

/* ---------------- Backup & history ---------------- */
function BackupPanel({ onRestored }: { onRestored: () => void }) {
  const toast = useToast();
  const [hist, setHist] = useState<HistoryEntry[]>([]);
  const reload = () => api.history().then(setHist).catch((e) => toast('err', e.message));
  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const download = async () => {
    const b = await api.backup();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(b, null, 2)], { type: 'application/json' }));
    a.download = `hcm-news-reporter-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
  };
  const restore = async (f: File) => {
    try {
      const j = JSON.parse(await f.text());
      if (!confirm('Khôi phục sẽ thay cài đặt và nguồn tin hiện tại bằng bản sao lưu (bản hiện tại được lưu vào lịch sử để hoàn tác). Tiếp tục?')) return;
      await api.restore(j);
      toast('ok', 'Đã khôi phục');
      onRestored();
      reload();
    } catch (e) {
      toast('err', `Không khôi phục được: ${(e as Error).message}`);
    }
  };
  return (
    <div>
      <Section title="Sao lưu / khôi phục">
        <div className="flex gap-2">
          <button className="btn-ghost" onClick={download}><Download className="h-4 w-4" /> Tải bản sao lưu</button>
          <label className="btn-ghost cursor-pointer"><FileUp className="h-4 w-4" /> Khôi phục từ tệp…<input type="file" accept=".json" className="hidden" onChange={(e) => e.target.files?.[0] && restore(e.target.files[0])} /></label>
        </div>
      </Section>
      <Section title="Lịch sử thay đổi" actions={<button className="btn-ghost btn-xs" onClick={reload}><History className="h-3 w-3" /> Tải lại</button>}>
        {hist.length === 0 && <p className="text-xs text-slate-500">Chưa có thay đổi nào.</p>}
        <table className="w-full">
          <tbody>
            {hist.map((h) => (
              <tr key={h.id}>
                <td className="td text-xs">{new Date(h.at).toLocaleString('vi-VN')}</td>
                <td className="td text-xs">{h.kind === 'settings' ? 'Cài đặt' : 'Nguồn tin'}</td>
                <td className="td text-xs">Trạng thái trước khi: {h.summary}</td>
                <td className="td">
                  <button className="btn-ghost btn-xs" onClick={async () => { if (!confirm('Khôi phục về phiên bản này? Bản hiện tại sẽ được lưu vào lịch sử.')) return; try { await api.rollback(h.id); toast('ok', 'Đã hoàn tác'); onRestored(); reload(); } catch (e) { toast('err', (e as Error).message); } }}>
                    <RotateCcw className="h-3 w-3" /> Khôi phục
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>
    </div>
  );
}
