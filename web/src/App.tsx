import { AlertTriangle, ArrowDown, ArrowUp, CheckCircle2, Download, ExternalLink, FileText, Play, RefreshCw, Search, Settings as Cog, Square, Wifi, WifiOff, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ASSESSMENT_LABEL } from '../../src/domain/classify';
import type { AdapterHealth, Article, Candidate, CategoryCode, EditorialAssessment, ReviewDecision, Settings, Source } from '../../src/domain/schemas';
import { formatVn, lastCompletedWindow, localInputToVnIso, todayWindow, validateWindow, vnIsoToLocalInput, yesterdayWindow } from '../../src/domain/timeWindow';
import { mergePatches, rootOf, secondariesOf } from '../../src/reports/assemble';
import { api, type ExportResult, type RunInfo } from './api';
import { SettingsDrawer } from './Settings';
import { STATE_LABEL, StateChip, useToast } from './ui';

type Tab = 'articles' | 'review' | 'ledger' | 'coverage' | 'export';
const ASSESS: EditorialAssessment[] = ['needs_attention', 'positive', 'neutral'];
const ASSESS_COLOR: Record<EditorialAssessment, string> = { needs_attention: 'text-red-700 border-red-300 bg-red-50', positive: 'text-green-700 border-green-300 bg-green-50', neutral: 'text-slate-700 border-slate-300 bg-slate-50' };

export function App() {
  const toast = useToast();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [sources, setSources] = useState<Source[]>([]);
  const [online, setOnline] = useState(navigator.onLine);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [runs, setRuns] = useState<RunInfo[]>([]);
  const [runId, setRunId] = useState<string | null>(null);
  const [run, setRun] = useState<RunInfo | null>(null);
  const [cands, setCands] = useState<Candidate[]>([]);
  const [arts, setArts] = useState<Article[]>([]);
  const [reviews, setReviews] = useState<Record<string, ReviewDecision>>({});
  const [tab, setTab] = useState<Tab>('articles');
  const [inspect, setInspect] = useState<string | null>(null);
  const [preset, setPreset] = useState<'last_completed' | 'today' | 'yesterday' | 'custom'>('last_completed');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => (window.removeEventListener('online', on), window.removeEventListener('offline', off));
  }, []);

  const applyPreset = useCallback((p: typeof preset, s: Settings) => {
    setPreset(p);
    const now = new Date();
    const { startClock: a, endClock: b } = s.reportWindow;
    const w = p === 'today' ? todayWindow(now, a, b) : p === 'yesterday' ? yesterdayWindow(now, a, b) : p === 'custom' && s.reportWindow.customFrom ? { from: s.reportWindow.customFrom, to: s.reportWindow.customTo } : lastCompletedWindow(now, a, b);
    setFrom(vnIsoToLocalInput(w.from));
    setTo(vnIsoToLocalInput(w.to));
  }, []);

  const loadRun = useCallback(async (id: string) => {
    const [r, c, a, rv] = await Promise.all([api.getRun(id), api.candidates(id), api.articles(id), api.review(id)]);
    setRun(r);
    setCands(c);
    setArts(a);
    setReviews(rv);
  }, []);

  // startup: local state first, then optional auto-collect (once per window, server-enforced)
  useEffect(() => {
    (async () => {
      try {
        const [s, src, rs] = await Promise.all([api.getSettings(), api.getSources(), api.listRuns()]);
        setSettings(s);
        setSources(src);
        setRuns(rs);
        applyPreset(s.reportWindow.defaultPreset, s);
        if (rs[0]) {
          setRunId(rs[0].runId);
          await loadRun(rs[0].runId);
        }
        if (api.mode === 'local' && s.startup.autoCollectLastCompletedWindow && navigator.onLine) {
          const w = lastCompletedWindow(new Date(), s.reportWindow.startClock, s.reportWindow.endClock);
          const r = await api.startRun({ from: w.from, to: w.to }, 'auto');
          if (r.runId) {
            toast('info', 'Tự động thu thập kỳ gần nhất…');
            setRunId(r.runId);
          }
        }
      } catch (e) {
        toast('err', `Không tải được dữ liệu: ${(e as Error).message}`);
      }
    })();
  }, [applyPreset, loadRun, toast]);

  // live progress
  useEffect(() => {
    if (!runId) return;
    loadRun(runId).catch(() => {});
    let t: ReturnType<typeof setTimeout> | null = null;
    const unsub = api.subscribe(runId, (e) => {
      if (t) return;
      t = setTimeout(() => {
        t = null;
        loadRun(runId).catch(() => {});
      }, e.type === 'done' ? 0 : 700);
      if (e.type === 'done') api.listRuns().then(setRuns).catch(() => {});
    });
    return () => {
      unsub();
      if (t) clearTimeout(t);
    };
  }, [runId, loadRun]);

  const windowIso = useMemo(() => {
    try {
      return { from: localInputToVnIso(from), to: localInputToVnIso(to) };
    } catch {
      return null;
    }
  }, [from, to]);
  const windowErr = windowIso ? validateWindow(windowIso) : 'Ngày giờ không hợp lệ';

  const collect = async () => {
    if (!windowIso || windowErr) return;
    try {
      if (preset === 'custom' && settings) {
        const s2 = await api.saveSettings({ ...settings, reportWindow: { ...settings.reportWindow, customFrom: windowIso.from, customTo: windowIso.to } }, 'Lưu khung giờ tùy chỉnh');
        setSettings(s2);
      }
      const r = await api.startRun(windowIso, 'manual');
      if (r.runId) {
        setRunId(r.runId);
        toast('info', `Bắt đầu thu thập ${formatVn(windowIso.from)} → ${formatVn(windowIso.to)}`);
      }
    } catch (e) {
      toast('err', (e as Error).message);
    }
  };

  const patch = async (articleId: string, p: Partial<ReviewDecision>) => {
    if (!run) return;
    // optimistic update: the control reacts immediately; reverted if the save fails
    const prev = reviews[articleId];
    setReviews((x) => ({ ...x, [articleId]: { ...(x[articleId] ?? { articleId, included: false, order: 0, updatedAt: '', changes: [] }), ...p } as ReviewDecision }));
    try {
      const r = await api.patchReview(run.runId, articleId, p);
      setReviews((x) => ({ ...x, [articleId]: r }));
    } catch (e) {
      setReviews((x) => {
        const n = { ...x };
        if (prev) n[articleId] = prev;
        else delete n[articleId];
        return n;
      });
      toast('err', `Không lưu được: ${(e as Error).message}`);
    }
  };

  const merge = async (secondaryId: string, targetId: string) => {
    const ps = mergePatches(secondaryId, targetId, reviews);
    if (!ps.length) return toast('err', 'Không thể gộp: hai bài đã cùng một tin hoặc gộp vào chính nó');
    for (const p of ps) await patch(p.articleId, p.patch);
    toast('ok', 'Đã gộp nguồn vào tin');
  };
  const split = (secondaryId: string) => patch(secondaryId, { groupId: null });

  const counts = run?.counts ?? {};
  const n = (...k: string[]) => k.reduce((s, x) => s + (counts[x] ?? 0), 0);
  const artById = useMemo(() => new Map(arts.map((a) => [a.id, a])), [arts]);
  const candByArticle = useMemo(() => new Map(cands.filter((c) => c.articleId).map((c) => [c.articleId!, c])), [cands]);
  const ready = arts.filter((a) => candByArticle.get(a.id)?.state === 'ready_for_review' && !candByArticle.get(a.id)?.reasonCode);
  const reviewQueue = arts.filter((a) => {
    const c = candByArticle.get(a.id);
    return c && (['date_unverified', 'parsed_partial'].includes(c.state) || (c.state === 'ready_for_review' && c.reasonCode));
  });
  const selected = Object.values(reviews).filter((r) => r.included).length;

  return (
    <div className="min-h-screen">
      {api.mode === 'demo' && (
        <div className="bg-amber-100 px-4 py-1.5 text-center text-xs text-amber-900">
          <b>BẢN DEMO trên GitHub Pages</b> – dữ liệu là bài <b>mẫu thử tổng hợp</b> (fixture, không phải tin thật) chạy qua đúng bộ thu thập/bóc tách của ứng dụng. Cài đặt lưu trong trình duyệt này. Thu thập báo thật cần bản local trên Windows.
        </div>
      )}
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-[1500px] items-center gap-3 px-4 py-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-navy-700 text-sm font-bold text-white">ĐT</div>
          <div>
            <h1 className="text-base font-bold leading-tight text-navy-700">HCM News Reporter</h1>
            <p className="text-xs text-slate-500">Điểm tin báo chí ngành xây dựng TP.HCM</p>
          </div>
          <span className="flex-1" />
          <span className={`chip ${online ? 'border-green-300 bg-green-50 text-green-800' : 'border-slate-300 bg-slate-100'}`}>
            {online ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />} {online ? 'Có Internet' : 'Ngoại tuyến – xem/duyệt/xuất dữ liệu đã lưu'}
          </span>
          {runs[0] && <span className="hidden text-xs text-slate-500 md:inline">Lượt gần nhất: {formatVn(runs[0].createdAt)} ({runs[0].status})</span>}
          <button className="btn-ghost" onClick={() => setSettingsOpen(true)}>
            <Cog className="h-4 w-4" /> Cài đặt
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-[1500px] space-y-4 px-4 py-4">
        {/* reporting window */}
        <section className="card flex flex-wrap items-end gap-3 p-3">
          <div>
            <span className="label">Khung giờ</span>
            <div className="inline-flex overflow-hidden rounded-md border border-slate-300">
              {([['last_completed', 'Kỳ gần nhất'], ['today', 'Hôm nay'], ['yesterday', 'Hôm qua'], ['custom', 'Tùy chỉnh']] as const).map(([k, l]) => (
                <button key={k} className={`px-3 py-1.5 text-sm ${preset === k ? 'bg-navy-700 text-white' : 'bg-white hover:bg-slate-50'}`} onClick={() => settings && (k === 'custom' ? setPreset('custom') : applyPreset(k, settings))}>
                  {l}
                </button>
              ))}
            </div>
          </div>
          <label>
            <span className="label">Từ (gồm)</span>
            <input type="datetime-local" className="input" value={from} onChange={(e) => (setFrom(e.target.value), setPreset('custom'))} />
          </label>
          <label>
            <span className="label">Đến (không gồm)</span>
            <input type="datetime-local" className="input" value={to} onChange={(e) => (setTo(e.target.value), setPreset('custom'))} />
          </label>
          <div className="text-xs text-slate-500">
            Asia/Ho_Chi_Minh (UTC+07:00)
            <br />
            {windowErr ? <span className="text-red-600">{windowErr}</span> : windowIso && `[${formatVn(windowIso.from)}, ${formatVn(windowIso.to)})`}
          </div>
          <span className="flex-1" />
          {run?.active ? (
            <button className="btn-danger" onClick={() => api.cancel(run.runId)}>
              <Square className="h-4 w-4" /> Dừng
            </button>
          ) : (
            <button className="btn-primary" disabled={!!windowErr || api.mode === 'demo' || !online} onClick={collect} title={api.mode === 'demo' ? 'Bản demo không thu thập báo thật' : ''}>
              <Play className="h-4 w-4" /> Thu thập
            </button>
          )}
          {runs.length > 0 && (
            <label>
              <span className="label">Lượt đã lưu</span>
              <select className="input w-64" value={runId ?? ''} onChange={(e) => setRunId(e.target.value)}>
                {runs.map((r) => (
                  <option key={r.runId} value={r.runId}>
                    {formatVn(r.window.from)} → {formatVn(r.window.to)} · {r.status}
                  </option>
                ))}
              </select>
            </label>
          )}
        </section>

        {/* source strip */}
        {run && (
          <section className="flex flex-wrap gap-2">
            {run.sources.map((s) => (
              <span key={s.sourceId} className={`chip ${s.status === 'ok' ? 'border-green-300 bg-green-50 text-green-800' : s.status === 'partial' ? 'border-amber-300 bg-amber-50 text-amber-800' : s.status === 'failed' ? 'border-red-300 bg-red-50 text-red-800' : s.status === 'running' ? 'border-blue-300 bg-blue-50 text-blue-800' : 'border-slate-300 bg-slate-50 text-slate-600'}`}>
                <b>{s.sourceName}</b> · {SRC_STATUS[s.status] ?? s.status} · {s.candidates} link{s.limitReached ? ' · chạm giới hạn' : ''}
                {s.adapter?.status === 'degraded' && <span className="font-bold text-red-700"> · bóc tách suy giảm</span>}
              </span>
            ))}
            {run.active && <span className="chip border-blue-300 bg-blue-50 text-blue-800"><RefreshCw className="h-3 w-3 animate-spin" /> đang chạy</span>}
          </section>
        )}

        {/* metrics */}
        <section className="grid grid-cols-2 gap-3 md:grid-cols-6">
          <Metric label="Link phát hiện" value={counts.total ?? 0} />
          <Metric label="Sẵn sàng duyệt" value={ready.length} tone="green" />
          <Metric label="Cần kiểm tra" value={reviewQueue.length} tone="amber" />
          <Metric label="Trùng lặp" value={n('duplicate')} />
          <Metric label="Lỗi / bị chặn" value={n('fetch_failed', 'blocked', 'parse_failed')} tone="red" />
          <Metric label="Đã chọn vào báo cáo" value={selected} tone="navy" />
        </section>

        {!run ? (
          <div className="card p-8 text-center text-slate-500">Chưa có lượt thu thập. Chọn khung giờ rồi bấm <b>Thu thập</b>. Cấu hình nguồn tin, từ khóa, địa bàn… trong <b>Cài đặt</b>.</div>
        ) : (
          <>
            <nav className="flex flex-wrap gap-1 border-b border-slate-200">
              {([['articles', `Bài sẵn sàng (${ready.length})`], ['review', `Cần kiểm tra (${reviewQueue.length})`], ['ledger', `Sổ ứng viên (${cands.length})`], ['coverage', 'Độ phủ & nguồn'], ['export', `Xuất báo cáo (${selected})`]] as const).map(([k, l]) => (
                <button key={k} onClick={() => setTab(k)} className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${tab === k ? 'border-navy-700 text-navy-700' : 'border-transparent text-slate-500 hover:text-slate-800'}`}>
                  {l}
                </button>
              ))}
            </nav>
            {tab === 'articles' && <ArticleList list={ready} reviews={reviews} cands={candByArticle} settings={settings} onInspect={setInspect} onPatch={patch} />}
            {tab === 'review' && <ArticleList list={reviewQueue} reviews={reviews} cands={candByArticle} settings={settings} onInspect={setInspect} onPatch={patch} reviewMode />}
            {tab === 'ledger' && <Ledger cands={cands} sources={sources} onInspect={(aid) => setInspect(aid)} />}
            {tab === 'coverage' && <Coverage run={run} cands={cands} onOpenSettings={() => setSettingsOpen(true)} onRetry={async (body) => { try { const r = await api.retry(run.runId, body); setRunId(r.runId); toast('info', 'Đang chạy lại…'); } catch (e) { toast('err', (e as Error).message); } }} />}
            {tab === 'export' && settings && <ExportPanel run={run} arts={artById} reviews={reviews} settings={settings} onPatch={patch} onInspect={setInspect} onMerge={merge} onSplit={split} />}
          </>
        )}
      </main>
      {inspect && artById.get(inspect) && settings && (
        <Inspector a={artById.get(inspect)!} c={candByArticle.get(inspect)} r={reviews[inspect]} settings={settings} onClose={() => setInspect(null)} onPatch={(p) => patch(inspect, p)}
          arts={artById} reviews={reviews} onMerge={merge} onSplit={split} onOpen={setInspect} />
      )}
      <SettingsDrawer
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onSaved={(s, src) => {
          setSettings(s);
          setSources(src);
        }}
      />
    </div>
  );
}

/** Same-event sources of one story: merged secondaries (split), clustering suggestions and manual pick (merge). */
function MergePanel({ primaryId, arts, reviews, onMerge, onSplit }: { primaryId: string; arts: Map<string, Article>; reviews: Record<string, ReviewDecision>; onMerge: (secondaryId: string, primaryId: string) => void; onSplit: (secondaryId: string) => void }) {
  const [pick, setPick] = useState('');
  const primary = arts.get(primaryId);
  if (!primary) return null;
  const merged = secondariesOf(primaryId, reviews).map((id) => arts.get(id)).filter((x): x is Article => !!x);
  const taken = new Set([primaryId, ...merged.map((m) => m.id)]);
  const available = [...arts.values()].filter((a) => !taken.has(a.id) && !reviews[a.id]?.groupId && secondariesOf(a.id, reviews).length === 0);
  const suggested = primary.duplicateGroupId ? available.filter((a) => a.duplicateGroupId === primary.duplicateGroupId) : [];
  const others = available.filter((a) => !suggested.includes(a)).sort((x, y) => x.title.localeCompare(y.title, 'vi'));
  return (
    <div className="rounded border border-purple-200 bg-purple-50/40 p-2 text-xs" data-testid={`merge-${primaryId}`}>
      <div className="mb-1 font-semibold text-purple-900">Nguồn cùng sự kiện ({merged.length + 1} bài)</div>
      <ul className="space-y-0.5">
        <li>
          <b>{primary.sourceName}</b> – {primary.title} <span className="text-slate-500">(bài chính{primary.publishedAt ? `, ${formatVn(primary.publishedAt)}` : ''})</span>
        </li>
        {merged.map((m) => (
          <li key={m.id} className="flex items-center gap-1">
            <span className="flex-1">
              <b>{m.sourceName}</b> – {m.title}
              {m.publishedAt ? <span className="text-slate-500"> ({formatVn(m.publishedAt)})</span> : <span className="text-amber-700"> (chưa rõ giờ đăng)</span>}
            </span>
            <button className="btn-ghost btn-xs" onClick={() => onSplit(m.id)}>Tách ra</button>
          </li>
        ))}
      </ul>
      {suggested.length > 0 && (
        <div className="mt-1">
          <span className="text-purple-900">Gợi ý cùng sự kiện (tiêu đề tương tự):</span>
          {suggested.map((s) => (
            <div key={s.id} className="flex items-center gap-1">
              <span className="flex-1"><b>{s.sourceName}</b> – {s.title}</span>
              <button className="btn-ghost btn-xs" onClick={() => onMerge(s.id, primaryId)}>Gộp vào tin này</button>
            </div>
          ))}
        </div>
      )}
      <div className="mt-1 flex gap-1">
        <select className="input py-1 text-xs" value={pick} onChange={(e) => setPick(e.target.value)} aria-label="Chọn bài để gộp nguồn">
          <option value="">Gộp thêm bài khác (cùng sự kiện)…</option>
          {others.map((o) => <option key={o.id} value={o.id}>{o.sourceName}: {o.title.slice(0, 90)}</option>)}
        </select>
        <button className="btn-ghost btn-xs" disabled={!pick} onClick={() => (onMerge(pick, primaryId), setPick(''))}>Gộp</button>
      </div>
    </div>
  );
}

const SRC_STATUS: Record<string, string> = { ok: 'OK', partial: 'Một phần', failed: 'Lỗi', running: 'Đang chạy', pending: 'Chờ', skipped_disabled: 'Đã tắt', manual_only: 'Nhập thủ công', cancelled: 'Đã hủy' };

function Metric({ label, value, tone }: { label: string; value: number; tone?: 'green' | 'amber' | 'red' | 'navy' }) {
  const c = tone === 'green' ? 'text-green-700' : tone === 'amber' ? 'text-amber-700' : tone === 'red' ? 'text-red-700' : tone === 'navy' ? 'text-navy-700' : 'text-slate-800';
  return (
    <div className="card p-3">
      <div className="text-xs text-slate-500">{label}</div>
      <div className={`text-2xl font-bold ${c}`}>{value}</div>
    </div>
  );
}

function ArticleList({ list, reviews, cands, settings, onInspect, onPatch, reviewMode }: { list: Article[]; reviews: Record<string, ReviewDecision>; cands: Map<string, Candidate>; settings: Settings | null; onInspect: (id: string) => void; onPatch: (id: string, p: Partial<ReviewDecision>) => void; reviewMode?: boolean }) {
  const [q, setQ] = useState('');
  const [cat, setCat] = useState<string>('all');
  const shown = list.filter((a) => (!q || a.title.toLowerCase().includes(q.toLowerCase())) && (cat === 'all' || (reviews[a.id]?.primaryCategory ?? a.primaryCategory) === cat));
  const catLabel = (c: string | null | undefined) => settings?.categories.find((x) => x.code === c)?.label ?? 'Chưa phân loại';
  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="absolute left-2 top-2 h-3.5 w-3.5 text-slate-400" />
          <input className="input w-72 pl-7" placeholder="Tìm tiêu đề…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <button className={`chip ${cat === 'all' ? 'border-navy-700 bg-navy-700 text-white' : 'border-slate-300 bg-white'}`} onClick={() => setCat('all')}>Tất cả</button>
        {settings?.categories.filter((c) => c.enabled).map((c) => (
          <button key={c.code} className={`chip ${cat === c.code ? 'border-navy-700 bg-navy-700 text-white' : 'border-slate-300 bg-white'}`} onClick={() => setCat(c.code)}>{c.label}</button>
        ))}
      </div>
      {shown.length === 0 && <div className="card p-6 text-center text-sm text-slate-500">{reviewMode ? 'Không có bài cần kiểm tra.' : 'Chưa có bài sẵn sàng trong khung giờ này.'}</div>}
      <div className="space-y-2">
        {shown.map((a) => {
          const r = reviews[a.id];
          const c = cands.get(a.id);
          const asm = r?.assessment ?? a.suggestedAssessment;
          const img = a.imageCandidates[0];
          return (
            <article key={a.id} className={`card flex gap-3 p-3 ${r?.included ? 'ring-2 ring-teal-500' : ''}`}>
              <label className="flex flex-col items-center gap-1 pt-1 text-[10px] text-slate-500">
                <input type="checkbox" className="h-4 w-4 accent-teal-600" disabled={!!r?.groupId} title={r?.groupId ? 'Bài đã gộp làm nguồn phụ của tin khác' : ''} checked={!!r?.included && !r?.groupId} onChange={(e) => onPatch(a.id, { included: e.target.checked, order: r?.order ?? Date.now() % 1e6 })} aria-label={`Chọn bài ${a.title}`} />
                chọn
              </label>
              {img ? (
                <img src={img.url} alt="" loading="lazy" referrerPolicy="no-referrer" className="h-20 w-28 shrink-0 rounded bg-slate-100 object-cover" onError={(e) => ((e.target as HTMLImageElement).style.visibility = 'hidden')} />
              ) : (
                <div className="flex h-20 w-28 shrink-0 items-center justify-center rounded bg-slate-100 text-[10px] text-slate-400">không có ảnh</div>
              )}
              <div className="min-w-0 flex-1">
                <div className="mb-1 flex flex-wrap items-center gap-1 text-xs">
                  <span className="font-semibold text-navy-700">{a.sourceName}</span>
                  <span className="text-slate-500">{a.publishedAt ? formatVn(a.publishedAt) : 'chưa rõ giờ đăng'}</span>
                  <span className="chip border-teal-200 bg-teal-50 text-teal-800">{catLabel(r?.primaryCategory ?? a.primaryCategory)}</span>
                  {asm && <span className={`chip ${ASSESS_COLOR[asm]}`}>{ASSESSMENT_LABEL[asm]}{!r?.assessment && ' (gợi ý)'}</span>}
                  {c && <StateChip state={c.state} />}
                  {r?.groupId ? (
                    <span className="chip border-purple-400 bg-purple-100 text-purple-900">đã gộp làm nguồn phụ</span>
                  ) : a.duplicateGroupId ? (
                    <span className="chip border-purple-300 bg-purple-50 text-purple-800">cùng sự kiện?</span>
                  ) : null}
                  {r && !r.groupId && secondariesOf(a.id, reviews).length > 0 && <span className="chip border-purple-300 bg-purple-50 text-purple-800">+{secondariesOf(a.id, reviews).length} nguồn</span>}
                  {a.extractionWarnings.length > 0 && <span className="chip border-amber-300 bg-amber-50 text-amber-800"><AlertTriangle className="h-3 w-3" /> {a.extractionWarnings.length} cảnh báo</span>}
                </div>
                <h3 className="font-semibold leading-snug">{r?.title ?? a.title}</h3>
                <p className="line-clamp-2 text-sm text-slate-600">{r?.summary ?? a.sapo}</p>
                {reviewMode && c?.reasonDetail && <p className="mt-1 text-xs text-amber-800">Lý do: {c.reasonDetail}</p>}
              </div>
              <div className="flex shrink-0 flex-col gap-1">
                <button className="btn-ghost btn-xs" onClick={() => onInspect(a.id)}><FileText className="h-3.5 w-3.5" /> Xem chi tiết</button>
                <a className="btn-ghost btn-xs" href={a.canonicalUrl ?? a.originalUrl} target="_blank" rel="noreferrer"><ExternalLink className="h-3.5 w-3.5" /> Bài gốc</a>
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}

function Ledger({ cands, sources, onInspect }: { cands: Candidate[]; sources: Source[]; onInspect: (articleId: string) => void }) {
  const [state, setState] = useState('all');
  const [src, setSrc] = useState('all');
  const [q, setQ] = useState('');
  const states = [...new Set(cands.map((c) => c.state))];
  const shown = cands.filter((c) => (state === 'all' || c.state === state) && (src === 'all' || c.sourceId === src) && (!q || c.url.includes(q) || (c.reasonCode ?? '').includes(q.toUpperCase())));
  const csv = () => {
    const rows = [['url', 'source', 'state', 'reason', 'detail', 'via', 'http'], ...cands.map((c) => [c.url, c.sourceId, c.state, c.reasonCode ?? '', c.reasonDetail ?? '', c.discoveredVia.map((d) => d.method).join('+'), String(c.httpStatus ?? '')])];
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['﻿' + rows.map((r) => r.map((x) => `"${x.replace(/"/g, '""')}"`).join(',')).join('\n')], { type: 'text/csv' }));
    a.download = 'so-ung-vien.csv';
    a.click();
  };
  return (
    <div className="card p-3">
      <div className="mb-2 flex flex-wrap gap-2">
        <select className="input w-56" value={state} onChange={(e) => setState(e.target.value)} aria-label="Lọc trạng thái">
          <option value="all">Mọi trạng thái ({cands.length})</option>
          {states.map((s) => <option key={s} value={s}>{STATE_LABEL[s] ?? s} ({cands.filter((c) => c.state === s).length})</option>)}
        </select>
        <select className="input w-48" value={src} onChange={(e) => setSrc(e.target.value)} aria-label="Lọc nguồn">
          <option value="all">Mọi nguồn</option>
          {[...new Set(cands.map((c) => c.sourceId))].map((s) => <option key={s} value={s}>{sources.find((x) => x.id === s)?.name ?? s}</option>)}
        </select>
        <input className="input w-64" placeholder="Tìm URL hoặc mã lý do…" value={q} onChange={(e) => setQ(e.target.value)} />
        <span className="flex-1" />
        <button className="btn-ghost" onClick={csv}><Download className="h-4 w-4" /> Tải CSV</button>
      </div>
      <p className="mb-2 text-xs text-slate-500">Mọi link phát hiện đều có trạng thái và lý do – không link nào bị bỏ âm thầm. Hiển thị {Math.min(shown.length, 500)}/{shown.length}.</p>
      <div className="max-h-[60vh] overflow-auto">
        <table className="w-full">
          <thead className="sticky top-0">
            <tr><th className="th">Trạng thái</th><th className="th">URL</th><th className="th">Phát hiện qua</th><th className="th">Lý do</th><th className="th">HTTP</th><th className="th" /></tr>
          </thead>
          <tbody>
            {shown.slice(0, 500).map((c) => (
              <tr key={c.id}>
                <td className="td"><StateChip state={c.state} /></td>
                <td className="td max-w-[28rem] truncate font-mono text-xs" title={c.url}><a href={c.url} target="_blank" rel="noreferrer" className="text-blue-700 hover:underline">{c.url.replace(/^https?:\/\//, '')}</a></td>
                <td className="td text-xs">{[...new Set(c.discoveredVia.map((d) => d.method))].join(' + ')}</td>
                <td className="td text-xs"><b>{c.reasonCode ?? ''}</b> {c.reasonDetail ?? ''}</td>
                <td className="td text-xs">{c.httpStatus ?? ''}</td>
                <td className="td">{c.articleId && <button className="btn-ghost btn-xs" onClick={() => onInspect(c.articleId!)}>Xem</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function AdapterHealthCard({ h, disabled, onRescan, onOpenSettings }: { h: AdapterHealth; disabled: boolean; onRescan: () => void; onOpenSettings: () => void }) {
  const pct = (x: number | null) => (x == null ? '—' : `${Math.round(x * 100)}%`);
  const tone = h.status === 'degraded' ? 'border-red-300 bg-red-50 text-red-900' : h.status === 'ok' ? 'border-green-200 bg-green-50 text-green-900' : 'border-slate-200 bg-slate-50 text-slate-700';
  return (
    <div className={`mt-2 rounded border p-2 text-xs ${tone}`} data-testid="adapter-health">
      <div className="flex flex-wrap items-center gap-2">
        <b>Bộ bóc tách: {h.status === 'degraded' ? 'SUY GIẢM' : h.status === 'ok' ? 'ổn định' : 'chưa đủ mẫu'}</b>
        <span>lỗi/thiếu/không rõ giờ {pct(h.failRate)} ({h.parseFailed} lỗi · {h.partial} thiếu · {h.dateUnknown} không rõ giờ / {h.fetched} bài tải)</span>
        <span>· mốc {h.baseline.runs} lượt trước: {pct(h.baseline.failRate)}</span>
        <span>· khung nội dung: <code>{h.mainContainer ?? '—'}</code>{h.baseline.mainContainer && h.baseline.mainContainer !== h.mainContainer ? <> (trước: <code>{h.baseline.mainContainer}</code>)</> : null}</span>
      </div>
      {h.reasons.length > 0 && <ul className="mt-1 list-disc pl-5">{h.reasons.map((r) => <li key={r}>{r}</li>)}</ul>}
      {h.status === 'degraded' && (
        <div className="mt-2">
          <b>Cách khắc phục:</b> bài của nguồn này đã chuyển sang hàng <i>Cần kiểm tra</i> và không còn được tự gắn nhãn "đầy đủ".
          <ol className="mt-1 list-decimal pl-5">
            <li>Mở vài bài trong hàng Cần kiểm tra, đối chiếu với bài gốc.</li>
            <li>Vào Cài đặt › Nguồn tin › <i>Thử thu thập</i> để xem khung nội dung mới; nếu cần, đặt "Mẫu URL bài" trong phần Nâng cao.</li>
            <li>Bấm <i>Quét lại nguồn này</i>. Khi một lượt tiếp theo bình thường, nguồn trở lại trạng thái ổn định.</li>
          </ol>
          <div className="mt-1 flex gap-2">
            <button className="btn-ghost btn-xs" onClick={onOpenSettings}>Mở cài đặt nguồn tin</button>
            <button className="btn-ghost btn-xs" disabled={disabled} onClick={onRescan}>Quét lại nguồn này</button>
          </div>
        </div>
      )}
    </div>
  );
}

function Coverage({ run, cands, onRetry, onOpenSettings }: { run: RunInfo; cands: Candidate[]; onRetry: (b: { mode: 'failed' | 'source' | 'expand'; sourceId?: string; extraLookbackHours?: number }) => void; onOpenSettings: () => void }) {
  const rec = run.reconciliation;
  return (
    <div className="space-y-3">
      <div className="card flex flex-wrap items-center gap-4 p-3 text-sm">
        <div>
          Đối soát sổ ứng viên: <b>{rec?.accounted ?? '?'} / {rec?.total ?? '?'}</b> link có trạng thái {rec?.balanced ? <CheckCircle2 className="inline h-4 w-4 text-green-600" /> : <AlertTriangle className="inline h-4 w-4 text-red-600" />}
          {rec && rec.transient > 0 && <span className="text-amber-700"> · {rec.transient} đang xử lý</span>}
        </div>
        <div>
          Mức đầy đủ lượt chạy:{' '}
          <b className={run.completeness === 'complete_within_enumerated_scope' ? 'text-green-700' : 'text-amber-700'}>
            {run.completeness === 'complete_within_enumerated_scope' ? 'Đủ trong phạm vi đã liệt kê' : run.completeness === 'incomplete' ? 'Chưa đầy đủ (xem lỗi/giới hạn bên dưới)' : 'Chưa xác định'}
          </b>
        </div>
        <span className="flex-1" />
        <button className="btn-ghost" disabled={run.active || api.mode === 'demo'} onClick={() => onRetry({ mode: 'failed' })}><RefreshCw className="h-4 w-4" /> Thử lại link lỗi</button>
      </div>
      <p className="text-xs text-slate-500">"Đủ 100%" chỉ có nghĩa mọi link <b>đã phát hiện</b> đều có trạng thái; không khẳng định đã bắt được mọi bài báo đăng (bài không xuất hiện ở RSS/sitemap/chuyên mục sẽ không thấy được).</p>
      {run.sources.map((s) => {
        const mine = cands.filter((c) => c.sourceId === s.sourceId);
        const by = (st: string) => mine.filter((c) => c.state === st).length;
        return (
          <div key={s.sourceId} className="card p-3">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <h3 className="font-semibold text-navy-700">{s.sourceName}</h3>
              <span className="chip border-slate-300">{SRC_STATUS[s.status] ?? s.status}</span>
              {s.limitReached && <span className="chip border-amber-300 bg-amber-50 text-amber-800">Chạm giới hạn quét – có thể còn bài chưa thấy</span>}
              {s.error && <span className="text-xs text-red-700">{s.error}</span>}
              <span className="flex-1" />
              <button className="btn-ghost btn-xs" disabled={run.active || api.mode === 'demo'} onClick={() => onRetry({ mode: 'source', sourceId: s.sourceId })}>Quét lại nguồn này</button>
              <button className="btn-ghost btn-xs" disabled={run.active || api.mode === 'demo'} onClick={() => onRetry({ mode: 'expand', sourceId: s.sourceId, extraLookbackHours: 12 })}>Mở rộng quét (+12 giờ)</button>
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs md:grid-cols-8">
              {[['Trang DS đã duyệt', `${s.listingPagesVisited}/${s.listingPageLimit}`], ['Link duy nhất', mine.length], ['Sẵn sàng', by('ready_for_review')], ['Bóc tách thiếu', by('parsed_partial')], ['Chưa rõ giờ', by('date_unverified')], ['Ngoài khung', by('outside_window')], ['Không liên quan', by('irrelevant_with_evidence')], ['Lỗi/chặn', by('fetch_failed') + by('blocked') + by('parse_failed')]].map(([l, v]) => (
                <div key={String(l)} className="rounded bg-slate-50 p-2"><div className="text-slate-500">{l}</div><div className="text-base font-semibold">{v}</div></div>
              ))}
            </div>
            {(s as any).newSinceLast !== undefined && <p className="mt-1 text-xs text-slate-500">Lần quét gần nhất thêm mới: {(s as any).newSinceLast} link</p>}
            {s.adapter && <AdapterHealthCard h={s.adapter} disabled={run.active || api.mode === 'demo'} onRescan={() => onRetry({ mode: 'source', sourceId: s.sourceId })} onOpenSettings={onOpenSettings} />}
            <table className="mt-2 w-full">
              <thead><tr><th className="th">Kênh</th><th className="th">URL</th><th className="th">Kết quả</th><th className="th">Link</th></tr></thead>
              <tbody>
                {s.routes.map((r, i) => (
                  <tr key={i}>
                    <td className="td text-xs">{r.method}</td>
                    <td className="td max-w-md truncate font-mono text-xs" title={r.url}>{r.url}</td>
                    <td className={`td text-xs ${r.status === 'ok' ? 'text-green-700' : r.status === 'limit' ? 'text-amber-700' : 'text-red-700'}`}>{r.status === 'ok' ? `OK (HTTP ${r.httpStatus})` : r.status === 'limit' ? r.error : `Lỗi ${r.httpStatus ?? ''} ${r.error ?? ''}`}</td>
                    <td className="td text-xs">{r.found}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}
    </div>
  );
}

function Inspector({ a, c, r, settings, onClose, onPatch, arts, reviews, onMerge, onSplit, onOpen }: { a: Article; c?: Candidate; r?: ReviewDecision; settings: Settings; onClose: () => void; onPatch: (p: Partial<ReviewDecision>) => void; arts: Map<string, Article>; reviews: Record<string, ReviewDecision>; onMerge: (s: string, p: string) => void; onSplit: (s: string) => void; onOpen: (id: string) => void }) {
  const mergedInto = r?.groupId ? arts.get(rootOf(a.id, reviews)) : undefined;
  const [title, setTitle] = useState(r?.title ?? a.title);
  const [summary, setSummary] = useState(r?.summary ?? a.sapo);
  const [short, setShort] = useState(r?.shortLabel ?? a.title.slice(0, 42));
  const [proposal, setProposal] = useState(r?.proposal ?? '');
  const asm = r?.assessment ?? a.suggestedAssessment;
  const max = asm === 'neutral' ? settings.editorial.summaryMaxChars.TL : asm === 'positive' ? settings.editorial.summaryMaxChars.TC : settings.editorial.summaryMaxChars.TT;
  // numbers in summary that do not appear in source text -> warning (EXT-07)
  const srcText = `${a.title} ${a.sapo} ${a.bodyText}`;
  const missingNums = (summary.match(/\d[\d.,]*/g) ?? []).filter((x) => !srcText.includes(x));
  const save = () => onPatch({ title, summary, shortLabel: short, proposal });
  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-slate-900/30" role="dialog" aria-modal="true" aria-label="Chi tiết bài">
      <div className="flex h-full w-full max-w-[1200px] flex-col bg-white shadow-2xl">
        <header className="flex items-center gap-2 border-b px-4 py-2.5">
          <h2 className="font-bold text-navy-700">Kiểm tra bài viết</h2>
          {c && <StateChip state={c.state} />}
          <span className="flex-1" />
          <a className="btn-ghost" href={a.canonicalUrl ?? a.originalUrl} target="_blank" rel="noreferrer"><ExternalLink className="h-4 w-4" /> Mở bài gốc</a>
          <button className="btn-ghost" onClick={onClose} aria-label="Đóng"><X className="h-4 w-4" /></button>
        </header>
        <div className="grid min-h-0 flex-1 grid-cols-1 overflow-auto lg:grid-cols-2">
          {/* source evidence (read-only) */}
          <div className="space-y-3 border-r p-4 text-sm">
            <h3 className="text-xs font-bold uppercase text-slate-500">Nội dung bóc tách từ báo (chỉ đọc)</h3>
            <div className="text-xs text-slate-600">
              {a.sourceName} · <a className="text-blue-700 underline" href={a.originalUrl} target="_blank" rel="noreferrer">{a.originalUrl}</a>
              {a.author && <> · Tác giả: {a.author}</>}
            </div>
            <div className={`rounded border p-2 text-xs ${a.extractionCompleteness === 'auto_checks_passed' ? 'border-green-200 bg-green-50' : 'border-amber-300 bg-amber-50'}`}>
              <b>Độ đầy đủ:</b> {a.extractionCompleteness === 'auto_checks_passed' ? 'Đạt các kiểm tra tự động (chưa phải xác nhận của người duyệt)' : a.extractionCompleteness === 'partial' ? 'Có dấu hiệu thiếu nội dung' : 'Lỗi'}
              {a.extractionWarnings.map((w) => <div key={w} className="text-amber-900">⚠ {w}</div>)}
              <div className="mt-1">Bộ bóc tách: {a.extractionAdapterVersion} · {a.contentSections.filter((s) => s.type === 'paragraph').length} đoạn · {a.contentSections.filter((s) => s.type === 'heading').length} tiêu đề phụ · {a.contentSections.filter((s) => s.type === 'table').length} bảng · {a.contentSections.filter((s) => s.type === 'figure').length} ảnh</div>
              <label className="mt-1 flex items-center gap-1"><input type="checkbox" checked={!!r?.extractionMarkedComplete} onChange={(e) => onPatch({ extractionMarkedComplete: e.target.checked })} /> Tôi đã đối chiếu bài gốc – xác nhận đủ nội dung quan trọng</label>
            </div>
            <div className="rounded border border-slate-200 p-2 text-xs">
              <b>Bằng chứng giờ đăng</b> ({a.dateConfidence === 'verified' ? 'đã xác minh' : a.dateConfidence === 'inferred' ? 'suy đoán' : 'không rõ'}): {a.publishedAt ? formatVn(a.publishedAt) : '—'}
              {a.modifiedAt && <> · cập nhật {formatVn(a.modifiedAt)} (không dùng để lọc)</>}
              <ul className="mt-1">{a.dateEvidence.map((d, i) => <li key={i}>[{d.source}/{d.field}] "{d.raw}" → {d.value ?? 'không đọc được'}</li>)}</ul>
              {a.dateConfidence !== 'verified' && <label className="mt-1 flex items-center gap-1"><input type="checkbox" checked={!!r?.timeVerifiedManually} onChange={(e) => onPatch({ timeVerifiedManually: e.target.checked })} /> Tôi đã kiểm tra giờ đăng trên bài gốc</label>}
            </div>
            <div className="rounded border border-slate-200 p-2 text-xs">
              <b>Địa bàn:</b> {a.location.status} – {a.location.evidence.slice(0, 4).join(' · ')}
              <br />
              <b>Lĩnh vực (gợi ý):</b> {a.classificationEvidence.join(' · ') || '—'}
              <br />
              <b>Tính chất (gợi ý):</b> {a.assessmentEvidence.join(' · ')}
            </div>
            <h4 className="text-base font-bold">{a.title}</h4>
            {a.sapo && <p className="font-semibold text-slate-700">{a.sapo}</p>}
            <div className="space-y-2">
              {a.contentSections.map((s) =>
                s.type === 'heading' ? <h5 key={s.ordinal} className="font-bold text-navy-700">{s.text}</h5>
                : s.type === 'table' ? (
                  <table key={s.ordinal} className="w-full border text-xs">
                    {s.caption && <caption className="text-left italic">{s.caption}</caption>}
                    <tbody>{s.rows?.map((row, i) => <tr key={i}>{row.map((cell, j) => <td key={j} className="border px-1">{cell}</td>)}</tr>)}</tbody>
                  </table>
                ) : s.type === 'figure' ? <p key={s.ordinal} className="rounded bg-slate-50 p-1 text-xs italic">[Ảnh] {s.caption || '(không có chú thích)'}</p>
                : s.type === 'list_item' ? <li key={s.ordinal} className="ml-4">{s.text}</li>
                : <p key={s.ordinal}>{s.text}</p>,
              )}
            </div>
          </div>
          {/* editorial overlay */}
          <div className="space-y-3 p-4">
            <h3 className="text-xs font-bold uppercase text-slate-500">Biên tập cho báo cáo (không sửa dữ liệu gốc)</h3>
            {mergedInto ? (
              <div className="rounded border border-purple-200 bg-purple-50 p-2 text-xs">
                Bài này đã được <b>gộp làm nguồn phụ</b> của tin: <button className="text-blue-700 underline" onClick={() => onOpen(mergedInto.id)}>{mergedInto.title}</button>
                <button className="btn-ghost btn-xs ml-2" onClick={() => onSplit(a.id)}>Tách ra thành tin riêng</button>
              </div>
            ) : (
              <>
                <label className="flex items-center gap-2"><input type="checkbox" className="h-4 w-4 accent-teal-600" checked={!!r?.included} onChange={(e) => onPatch({ included: e.target.checked, order: r?.order ?? Date.now() % 1e6 })} /> Đưa vào báo cáo</label>
                <MergePanel primaryId={a.id} arts={arts} reviews={reviews} onMerge={onMerge} onSplit={onSplit} />
              </>
            )}
            <div>
              <span className="label">Tính chất tin</span>
              <div className="flex gap-1">
                {ASSESS.map((x) => <button key={x} className={`chip ${asm === x ? ASSESS_COLOR[x] + ' font-bold' : 'border-slate-300 bg-white'}`} onClick={() => onPatch({ assessment: x })}>{ASSESSMENT_LABEL[x]}</button>)}
              </div>
              {!r?.assessment && <p className="text-xs text-amber-700">Đang là gợi ý tự động – bấm để xác nhận.</p>}
            </div>
            <label className="block">
              <span className="label">Lĩnh vực chính</span>
              <select className="input" value={r?.primaryCategory ?? a.primaryCategory ?? ''} onChange={(e) => onPatch({ primaryCategory: (e.target.value || null) as CategoryCode | null })}>
                <option value="">Chưa phân loại</option>
                {settings.categories.map((c2) => <option key={c2.code} value={c2.code}>{c2.label}</option>)}
              </select>
            </label>
            <label className="block"><span className="label">Tiêu đề trên báo cáo ({title.length}/120)</span><input className={`input ${title.length > 120 ? 'border-amber-500' : ''}`} value={title} onChange={(e) => setTitle(e.target.value)} onBlur={save} /></label>
            <label className="block"><span className="label">Nhãn ngắn trên bìa ({short.length}/42)</span><input className={`input ${short.length > 42 ? 'border-amber-500' : ''}`} value={short} onChange={(e) => setShort(e.target.value)} onBlur={save} /></label>
            <label className="block">
              <span className="label">Tóm tắt ({summary.length}/{max})</span>
              <textarea className={`input ${summary.length > max ? 'border-amber-500' : ''}`} rows={5} value={summary} onChange={(e) => setSummary(e.target.value)} onBlur={save} />
              {summary.length > max && <span className="text-xs text-amber-700">Dài hơn khung – rút gọn để tránh tràn trang.</span>}
              {missingNums.length > 0 && <span className="block text-xs text-red-700">⚠ Số liệu không có trong bài gốc: {missingNums.join(', ')} – kiểm tra lại, không thêm dữ kiện ngoài bài.</span>}
            </label>
            {asm === 'needs_attention' && (
              <label className="block"><span className="label">Đề xuất đầu mối (DỰ THẢO – cần lãnh đạo duyệt)</span><textarea className="input" rows={2} placeholder="Đề xuất: … (đầu mối đề xuất, chờ rà soát)" value={proposal} onChange={(e) => setProposal(e.target.value)} onBlur={save} /></label>
            )}
            <div>
              <span className="label">Ảnh báo gốc (chỉ ảnh thật từ bài)</span>
              <div className="grid grid-cols-3 gap-2">
                {a.imageCandidates.map((im) => {
                  const chosen = (r?.primaryImageUrl === undefined ? a.imageCandidates[0]?.url : r.primaryImageUrl) === im.url;
                  return (
                    <button key={im.url} className={`overflow-hidden rounded border text-left text-[10px] ${chosen ? 'ring-2 ring-teal-500' : ''}`} onClick={() => onPatch({ primaryImageUrl: im.url })}>
                      <img src={im.url} alt={im.caption ?? ''} referrerPolicy="no-referrer" className="h-20 w-full bg-slate-100 object-cover" onError={(e) => ((e.target as HTMLImageElement).style.visibility = 'hidden')} />
                      <div className="p-1">{im.origin} · quyền: {im.rightsStatus === 'review' ? 'cần xem' : im.rightsStatus}{im.credit && ` · ${im.credit}`}</div>
                    </button>
                  );
                })}
                <button className={`rounded border p-2 text-xs ${r?.primaryImageUrl === null ? 'ring-2 ring-teal-500' : ''}`} onClick={() => onPatch({ primaryImageUrl: null })}>Không dùng ảnh (bố cục chữ)</button>
              </div>
            </div>
            <button className="btn-primary" onClick={save}>Lưu biên tập</button>
            {r?.changes?.length ? (
              <details className="text-xs text-slate-600"><summary>Lịch sử chỉnh sửa ({r.changes.length})</summary>{r.changes.slice(-20).map((ch, i) => <div key={i}>{new Date(ch.at).toLocaleString('vi-VN')} · {ch.field}</div>)}</details>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

function ExportPanel({ run, arts, reviews, settings, onPatch, onInspect, onMerge, onSplit }: { run: RunInfo; arts: Map<string, Article>; reviews: Record<string, ReviewDecision>; settings: Settings; onPatch: (id: string, p: Partial<ReviewDecision>) => void; onInspect: (id: string) => void; onMerge: (s: string, p: string) => void; onSplit: (s: string) => void }) {
  const toast = useToast();
  const [res, setRes] = useState<ExportResult | null>(null);
  const [formats, setFormats] = useState<Array<'pptx' | 'pdf'>>(settings.report.outputFormats);
  const [busy, setBusy] = useState(false);
  const sel = Object.values(reviews).filter((r) => r.included && !r.groupId).sort((a, b) => a.order - b.order);
  const go = async (dryRun: boolean) => {
    setBusy(true);
    try {
      const r = await api.exportRun(run.runId, formats, dryRun);
      setRes(r);
      if (r.ok) toast('ok', `Đã xuất ${r.files?.length ?? 0} tệp`);
    } catch (e) {
      toast('err', (e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    go(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(Object.values(reviews).map((s) => [s.articleId, s.included, s.groupId, s.assessment, s.summary, s.timeVerifiedManually]))]);
  const move = (i: number, d: -1 | 1) => {
    const a = sel[i];
    const b = sel[i + d];
    if (!a || !b) return;
    onPatch(a.articleId, { order: b.order });
    onPatch(b.articleId, { order: a.order });
  };
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_380px]">
      <div className="card p-3">
        <h3 className="mb-2 font-semibold text-navy-700">Tin đã chọn ({sel.length}) – thứ tự trên slide</h3>
        {sel.length === 0 && <p className="text-sm text-slate-500">Chưa chọn tin nào. Tích ô "chọn" ở danh sách bài.</p>}
        {ASSESS.map((g) => {
          const list = sel.filter((r) => (r.assessment ?? arts.get(r.articleId)?.suggestedAssessment) === g);
          if (!list.length) return null;
          return (
            <div key={g} className="mb-3">
              <h4 className={`mb-1 text-xs font-bold uppercase ${ASSESS_COLOR[g].split(' ')[0]}`}>{ASSESSMENT_LABEL[g]} ({list.length})</h4>
              {list.map((r) => {
                const a = arts.get(r.articleId);
                const i = sel.indexOf(r);
                const nMerged = secondariesOf(r.articleId, reviews).length;
                const pubs = [a?.sourceName, ...secondariesOf(r.articleId, reviews).map((id) => arts.get(id)?.sourceName)].filter(Boolean);
                return (
                  <div key={r.articleId} className="mb-1 rounded border border-slate-200 p-2 text-sm">
                    <div className="flex items-center gap-2">
                      <button className="btn-ghost btn-xs" onClick={() => move(i, -1)} aria-label="Lên"><ArrowUp className="h-3 w-3" /></button>
                      <button className="btn-ghost btn-xs" onClick={() => move(i, 1)} aria-label="Xuống"><ArrowDown className="h-3 w-3" /></button>
                      <span className="flex-1">{r.title ?? a?.title}{!r.assessment && <span className="ml-1 text-xs text-amber-700">(tính chất là gợi ý)</span>}</span>
                      <button className="btn-ghost btn-xs" onClick={() => onInspect(r.articleId)}>Biên tập</button>
                      <button className="btn-danger btn-xs" onClick={() => onPatch(r.articleId, { included: false })}>Bỏ</button>
                    </div>
                    <details className="mt-1" open={nMerged > 0 || !!a?.duplicateGroupId}>
                      <summary className="cursor-pointer text-xs text-slate-600">Nguồn: {[...new Set(pubs)].join('  |  ')}{a?.duplicateGroupId && nMerged === 0 ? ' · có bài có thể cùng sự kiện' : ''}</summary>
                      <MergePanel primaryId={r.articleId} arts={arts} reviews={reviews} onMerge={onMerge} onSplit={onSplit} />
                    </details>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
      <div className="card space-y-3 p-3">
        <h3 className="font-semibold text-navy-700">Xuất báo cáo</h3>
        {settings.report.templateFile ? (
          <p className="rounded bg-green-50 p-2 text-xs text-green-900">Mẫu: <b>mẫu PPTX gốc</b> ({settings.report.templateFile})</p>
        ) : (
          <p className="rounded bg-amber-50 p-2 text-xs text-amber-900">Mẫu: <b>BẢN DEMO</b> – chưa tải mẫu PPTX gốc (Cài đặt › Báo cáo & mẫu).</p>
        )}
        <div className="flex gap-4">
          {(['pptx', 'pdf'] as const).map((f) => (
            <label key={f} className="flex items-center gap-1 text-sm"><input type="checkbox" checked={formats.includes(f)} onChange={(e) => setFormats(e.target.checked ? [...formats, f] : formats.filter((x) => x !== f))} /> .{f}</label>
          ))}
        </div>
        {res?.blockers?.length ? <div className="rounded border border-red-200 bg-red-50 p-2 text-xs text-red-800"><b>Chưa thể xuất:</b>{res.blockers.map((b) => <div key={b}>• {b}</div>)}</div> : null}
        {res?.warnings?.length ? <div className="rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900"><b>Cảnh báo:</b>{res.warnings.map((b) => <div key={b}>• {b}</div>)}</div> : null}
        <button className="btn-teal w-full justify-center" disabled={busy || !!res?.blockers?.length || formats.length === 0} onClick={() => go(false)}>
          <Download className="h-4 w-4" /> {busy ? 'Đang xuất…' : 'Xuất báo cáo'}
        </button>
        {res?.ok && (
          <div className="text-xs">
            <p className="font-semibold text-green-700">Đã tạo:</p>
            {res.files?.map((f) => <a key={f} className="block text-blue-700 underline" href={api.exportUrl(f)}>{f}</a>)}
            {res.pdfStatus && res.pdfStatus !== 'ok' && res.pdfStatus !== 'not_requested' && <p className="text-amber-800">PDF: {res.pdfStatus}</p>}
          </div>
        )}
      </div>
    </div>
  );
}
