import { Copy, FlaskConical, Pencil, Plus, Radar, Trash2, Upload } from 'lucide-react';
import { useState } from 'react';
import { sourceFromUrl } from '../../src/domain/defaults';
import { SourceSchema, type DiscoveryMethod, type Source } from '../../src/domain/schemas';
import { slugify } from '../../src/domain/text';
import { api } from './api';
import { Field, NumberField, Section, Select, Toggle, UrlList, urlError, useToast } from './ui';

const METHODS: Array<[DiscoveryMethod, string]> = [
  ['rss', 'RSS/Atom'],
  ['sitemap', 'Sitemap'],
  ['section', 'Trang chuyên mục + phân trang'],
  ['search', 'Tìm kiếm của báo'],
];

export function SourcesPanel({ sources, setSources }: { sources: Source[]; setSources: (s: Source[]) => void }) {
  const toast = useToast();
  const [editing, setEditing] = useState<string | null>(null);
  const [wizard, setWizard] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [tests, setTests] = useState<Record<string, any>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const patch = (id: string, p: Partial<Source>) => setSources(sources.map((s) => (s.id === id ? { ...s, ...p } : s)));
  const test = async (s: Source) => {
    setBusy(s.id);
    try {
      const r = await api.testSource(s);
      setTests((t) => ({ ...t, [s.id]: r }));
      toast('ok', `${s.name}: tìm thấy ${r.stats.candidates} link ứng viên`);
    } catch (e) {
      setTests((t) => ({ ...t, [s.id]: { error: (e as Error).message } }));
      toast('err', (e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-2">
        <button className="btn-teal" onClick={() => setWizard(true)}>
          <Plus className="h-4 w-4" /> Thêm nguồn
        </button>
        <button className="btn-ghost" onClick={() => setImportOpen(true)}>
          <Upload className="h-4 w-4" /> Nhập websites.txt từ Skill
        </button>
      </div>
      {wizard && <AddSourceWizard existing={sources} onClose={() => setWizard(false)} onAdd={(s) => { setSources([...sources, s]); setWizard(false); setEditing(s.id); }} />}
      {importOpen && <ImportSkill existing={sources} onClose={() => setImportOpen(false)} onApply={(list) => { setSources(list); setImportOpen(false); }} />}
      <div className="space-y-2">
        {sources.map((s, idx) => (
          <div key={s.id} className={`card p-3 ${!s.enabled ? 'opacity-75' : ''}`} data-testid={`source-${s.id}`}>
            <div className="flex flex-wrap items-center gap-2">
              <Toggle checked={s.enabled} onChange={(v) => patch(s.id, { enabled: v })} label="" />
              <div className="min-w-0 flex-1">
                <div className="font-semibold text-navy-700">
                  {s.name} <span className="font-mono text-xs font-normal text-slate-500">{s.baseUrl}</span>
                </div>
                <div className="text-xs text-slate-500">
                  {s.fetchMode === 'manual_only' ? <span className="text-amber-700">Chỉ nhập link thủ công · </span> : null}
                  RSS {s.rssUrls.length} · Sitemap {s.sitemapUrls.length} · Chuyên mục {s.sectionUrls.length} · tối đa {s.crawlLimits.maxListingPages} trang / {s.crawlLimits.maxArticleFetches} bài · nguồn gốc: {s.origin}
                </div>
              </div>
              <button className="btn-ghost btn-xs" disabled={busy === s.id} onClick={() => test(s)}>
                <FlaskConical className="h-3.5 w-3.5" /> {busy === s.id ? 'Đang thử…' : 'Thử thu thập'}
              </button>
              <button className="btn-ghost btn-xs" onClick={() => setEditing(editing === s.id ? null : s.id)}>
                <Pencil className="h-3.5 w-3.5" /> Sửa
              </button>
              <button className="btn-ghost btn-xs" onClick={() => setSources([...sources.slice(0, idx + 1), { ...s, id: `${s.id}-copy`.slice(0, 40), name: `${s.name} (bản sao)`, origin: 'user' }, ...sources.slice(idx + 1)])}>
                <Copy className="h-3.5 w-3.5" /> Nhân bản
              </button>
              <button className="btn-danger btn-xs" onClick={() => confirm(`Xóa nguồn "${s.name}"? (có thể khôi phục ở Sao lưu & lịch sử)`) && setSources(sources.filter((x) => x.id !== s.id))}>
                <Trash2 className="h-3.5 w-3.5" /> Xóa
              </button>
            </div>
            {tests[s.id] && <TestResult r={tests[s.id]} />}
            {editing === s.id && <SourceEditor s={s} onChange={(p) => patch(s.id, p)} />}
          </div>
        ))}
      </div>
    </div>
  );
}

function TestResult({ r }: { r: any }) {
  if (r.error) return <p className="mt-2 rounded bg-red-50 p-2 text-xs text-red-800">{r.error}</p>;
  return (
    <div className="mt-2 rounded border border-slate-200 bg-slate-50 p-2 text-xs">
      <b>Kết quả thử ({r.stats.candidates} link ứng viên):</b>
      <ul className="mt-1 space-y-0.5">
        {r.stats.routes.map((rt: any, i: number) => (
          <li key={i} className={rt.status === 'ok' ? 'text-green-800' : rt.status === 'limit' ? 'text-amber-800' : 'text-red-700'}>
            [{rt.method}] {rt.status} · HTTP {rt.httpStatus ?? '-'} · {rt.found} link · <span className="font-mono">{rt.url}</span> {rt.error ?? ''}
          </li>
        ))}
      </ul>
      {r.samples?.length > 0 && (
        <table className="mt-2 w-full">
          <thead>
            <tr><th className="th">Bài mẫu</th><th className="th">Giờ đăng</th><th className="th">Đoạn/Bảng/Ảnh</th><th className="th">Bóc tách</th></tr>
          </thead>
          <tbody>
            {r.samples.map((s: any) => (
              <tr key={s.url}>
                <td className="td"><a className="text-blue-700 underline" href={s.url} target="_blank" rel="noreferrer">{s.title ?? s.url}</a>{s.error && <span className="text-red-700"> {s.error}</span>}</td>
                <td className="td">{s.publishedAt ?? '—'} <span className="text-slate-500">({s.dateConfidence})</span></td>
                <td className="td">{s.paragraphs}/{s.tables}/{s.images}</td>
                <td className="td">{s.completeness === 'auto_checks_passed' ? 'Đạt kiểm tra tự động' : s.completeness}{s.warnings?.length ? <div className="text-amber-700">{s.warnings.join('; ')}</div> : null}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="mt-1 text-slate-500">Lưu ý: link phát hiện tự động là giả thuyết cho tới khi bạn kiểm tra; không có nghĩa đã quét đủ 100% tin của báo.</p>
    </div>
  );
}

function SourceEditor({ s, onChange }: { s: Source; onChange: (p: Partial<Source>) => void }) {
  const lim = (p: Partial<Source['crawlLimits']>) => onChange({ crawlLimits: { ...s.crawlLimits, ...p } });
  const v = SourceSchema.safeParse(s);
  return (
    <div className="mt-3 grid gap-3 border-t border-slate-200 pt-3 md:grid-cols-2">
      <Field label="Tên hiển thị" error={!s.name.trim() ? 'Cần tên nguồn' : null}>
        <input className="input" value={s.name} onChange={(e) => onChange({ name: e.target.value })} />
      </Field>
      <Field label="Trang chủ" error={urlError(s.baseUrl)}>
        <input className="input font-mono text-xs" value={s.baseUrl} onChange={(e) => onChange({ baseUrl: e.target.value })} />
      </Field>
      <NumberField label="Độ ưu tiên" value={s.priority} min={1} max={99} onChange={(n) => onChange({ priority: n })} help="Số nhỏ = ưu tiên cao khi sắp xếp" />
      <Select label="Chế độ lấy tin" value={s.fetchMode} onChange={(v) => onChange({ fetchMode: v })} options={[['direct', 'Ứng dụng tự thu thập'], ['manual_only', 'Báo chặn tự động – chỉ nhập link thủ công']]} />
      <div className="md:col-span-2">
        <span className="label">Kênh dò link được bật</span>
        <div className="flex flex-wrap gap-3">
          {METHODS.map(([m, l]) => (
            <label key={m} className="flex items-center gap-1 text-sm">
              <input type="checkbox" checked={s.discoveryMethods.includes(m)} onChange={(e) => onChange({ discoveryMethods: e.target.checked ? [...s.discoveryMethods, m] : s.discoveryMethods.filter((x) => x !== m) })} /> {l}
            </label>
          ))}
        </div>
      </div>
      <UrlList label="RSS / Atom" values={s.rssUrls} onChange={(v) => onChange({ rssUrls: v })} verified={s.verifiedRoutes} help="Không đoán link RSS: chỉ thêm link đã thấy trên báo hoặc từ Dò cấu trúc" />
      <UrlList label="Sitemap / sitemap index" values={s.sitemapUrls} onChange={(v) => onChange({ sitemapUrls: v })} verified={s.verifiedRoutes} />
      <UrlList label="Trang chuyên mục / danh sách" values={s.sectionUrls} onChange={(v) => onChange({ sectionUrls: v })} verified={s.verifiedRoutes} help="Ứng dụng sẽ theo link 'Trang sau' tới độ sâu cấu hình" />
      <UrlList label="Trang tìm kiếm của báo (nếu được phép)" values={s.searchUrls} onChange={(v) => onChange({ searchUrls: v })} verified={s.verifiedRoutes} />
      <NumberField label="Tối đa trang danh sách / lượt" value={s.crawlLimits.maxListingPages} min={1} max={500} onChange={(n) => lim({ maxListingPages: n })} help="Đạt giới hạn → cảnh báo 'chưa quét hết'" />
      <NumberField label="Độ sâu phân trang" value={s.crawlLimits.maxDepth} min={0} max={10} onChange={(n) => lim({ maxDepth: n })} />
      <NumberField label="Tối đa bài tải / lượt" value={s.crawlLimits.maxArticleFetches} min={1} max={2000} onChange={(n) => lim({ maxArticleFetches: n })} />
      <Toggle checked={s.crawlLimits.followPagination} onChange={(v) => lim({ followPagination: v })} label="Theo link phân trang (Trang sau)" />
      <NumberField label="Kết nối đồng thời tới báo" value={s.maxConcurrency} min={1} max={8} onChange={(n) => onChange({ maxConcurrency: n })} />
      <NumberField label="Nghỉ giữa 2 lần gọi" value={s.pauseMs} min={0} max={30000} step={100} suffix="ms" onChange={(n) => onChange({ pauseMs: n })} />
      <details className="md:col-span-2">
        <summary className="cursor-pointer text-xs font-semibold text-slate-600">Nâng cao: mẫu nhận diện URL bài viết</summary>
        <div className="mt-2 grid gap-3 md:grid-cols-2">
          <Field label="Mẫu URL bài (biểu thức, để trống = tự nhận diện)" help="Ví dụ: -\d{9,}\.htm$ . Có kiểm tra an toàn.">
            <input className="input font-mono text-xs" value={s.articleUrlPattern} onChange={(e) => onChange({ articleUrlPattern: e.target.value })} />
          </Field>
          <Field label="Mẫu URL loại trừ">
            <input className="input font-mono text-xs" value={s.excludeUrlPattern} onChange={(e) => onChange({ excludeUrlPattern: e.target.value })} />
          </Field>
        </div>
      </details>
      <Field label="Ghi chú">
        <textarea className="input" rows={2} value={s.notes} onChange={(e) => onChange({ notes: e.target.value })} />
      </Field>
      {!v.success && <p className="text-xs text-red-600 md:col-span-2">{v.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}</p>}
    </div>
  );
}

function AddSourceWizard({ existing, onClose, onAdd }: { existing: Source[]; onClose: () => void; onAdd: (s: Source) => void }) {
  const toast = useToast();
  const [url, setUrl] = useState('https://');
  const [det, setDet] = useState<any>(null);
  const [pick, setPick] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const err = urlError(url);
  const detect = async () => {
    setBusy(true);
    try {
      const d = await api.detect(url);
      setDet(d);
      setPick(Object.fromEntries([...d.rss, ...d.sitemaps].map((u: string) => [u, true])));
    } catch (e) {
      toast('err', (e as Error).message);
      setDet({ rss: [], sitemaps: [], sections: [], sampleArticles: [], errors: [(e as Error).message], name: '' });
    } finally {
      setBusy(false);
    }
  };
  const create = () => {
    const base = sourceFromUrl(url, { origin: 'user' });
    let id = base.id || slugify(url);
    while (existing.some((s) => s.id === id)) id = `${id}-2`;
    const chosen = Object.entries(pick).filter(([, v]) => v).map(([k]) => k);
    onAdd({
      ...base,
      id,
      name: det?.name || base.name,
      rssUrls: det ? chosen.filter((u) => det.rss.includes(u)) : base.rssUrls,
      sitemapUrls: det ? chosen.filter((u) => det.sitemaps.includes(u)) : [],
      sectionUrls: det ? (chosen.filter((u) => det.sections.includes(u)).length ? chosen.filter((u) => det.sections.includes(u)) : [new URL(url).origin + '/']) : base.sectionUrls,
      verifiedRoutes: [],
    });
  };
  return (
    <div className="card mb-3 border-teal-300 p-3">
      <h4 className="mb-2 font-semibold text-teal-700">Thêm nguồn mới</h4>
      <div className="flex gap-2">
        <input className="input font-mono" value={url} onChange={(e) => setUrl(e.target.value)} aria-label="URL trang chủ báo" />
        <button className="btn-ghost" disabled={!!err || busy} onClick={detect}>
          <Radar className="h-4 w-4" /> {busy ? 'Đang dò…' : 'Dò cấu trúc tự động'}
        </button>
      </div>
      {err && url !== 'https://' && <p className="text-xs text-red-600">{err}</p>}
      {det && (
        <div className="mt-2 space-y-2 text-xs">
          {det.errors?.length > 0 && <p className="text-red-700">{det.errors.join('; ')}</p>}
          <p className="text-slate-600">Các mục dưới đây là <b>giả thuyết</b> từ trang chủ/robots.txt – tích chọn kênh muốn dùng. Bạn có thể thêm/sửa sau.</p>
          {(['rss', 'sitemaps', 'sections'] as const).map((k) => (
            <div key={k}>
              <b>{k === 'rss' ? 'RSS' : k === 'sitemaps' ? 'Sitemap' : 'Chuyên mục'}</b> ({det[k].length})
              <div className="max-h-32 overflow-auto">
                {det[k].map((u: string) => (
                  <label key={u} className="flex items-center gap-1 font-mono">
                    <input type="checkbox" checked={!!pick[u]} onChange={(e) => setPick({ ...pick, [u]: e.target.checked })} /> {u}
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
      <div className="mt-3 flex gap-2">
        <button className="btn-teal" disabled={!!err} onClick={create}>Tạo thẻ nguồn (chưa lưu)</button>
        <button className="btn-ghost" onClick={onClose}>Hủy</button>
      </div>
    </div>
  );
}

function ImportSkill({ existing, onClose, onApply }: { existing: Source[]; onClose: () => void; onApply: (list: Source[]) => void }) {
  const toast = useToast();
  const [text, setText] = useState('');
  const [res, setRes] = useState<{ sources: Source[]; comments: string[]; errors: string[] } | null>(null);
  const parse = async () => {
    try {
      setRes(await api.importSkill(text));
    } catch (e) {
      toast('err', (e as Error).message);
    }
  };
  const added = res?.sources.filter((s) => !existing.some((e) => e.id === s.id)) ?? [];
  const overlap = res?.sources.filter((s) => existing.some((e) => e.id === s.id)) ?? [];
  return (
    <Section title="Nhập danh sách báo từ websites.txt" actions={<button className="btn-ghost btn-xs" onClick={onClose}>Đóng</button>}>
      <input type="file" accept=".txt" onChange={async (e) => { const f = e.target.files?.[0]; if (f) setText(await f.text()); }} />
      <textarea className="input font-mono text-xs" rows={6} placeholder={'https://thanhnien.vn\nweb: https://dantri.com.vn'} value={text} onChange={(e) => setText(e.target.value)} />
      <button className="btn-ghost" onClick={parse} disabled={!text.trim()}>Xem trước</button>
      {res && (
        <div className="text-xs">
          <p>Đọc được {res.sources.length} nguồn: <b>{added.length} mới</b>, {overlap.length} đã có (giữ nguyên cấu hình hiện tại, không ghi đè).</p>
          {res.errors.map((e) => <p key={e} className="text-red-700">{e}</p>)}
          <ul className="my-1 list-disc pl-5">{added.map((s) => <li key={s.id}>{s.name} – {s.baseUrl}{s.fetchMode === 'manual_only' ? ' (chỉ nhập thủ công)' : ''}</li>)}</ul>
          <button className="btn-teal" disabled={!added.length} onClick={() => confirm(`Thêm ${added.length} nguồn mới vào danh sách? Nguồn đã có không bị thay đổi.`) && onApply([...existing, ...added])}>Thêm {added.length} nguồn</button>
        </div>
      )}
    </Section>
  );
}
