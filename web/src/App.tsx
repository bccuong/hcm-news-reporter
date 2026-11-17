import { AlarmClock, AlertTriangle, HelpCircle, History, Lightbulb, ArrowDown, ArrowRight, ArrowUp, BarChart3, CalendarClock, Check, Inbox, LogIn, LogOut, MapPin, CheckCircle2, ChevronDown, Download, ExternalLink, FileText, Play, RefreshCw, Search, Settings as Cog, Square, Trash2, Undo2, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState, useRef } from 'react';
import { suggestAssignment } from '../../src/domain/assignment';
import { ASSESSMENT_LABEL } from '../../src/domain/classify';
import { EXCLUDE_REASONS, EXCLUDE_REASON_LABEL, type AdapterHealth, type Article, type Candidate, type CategoryCode, type EditorialAssessment, type ExcludeReason, type ReviewDecision, type Settings, type Source } from '../../src/domain/schemas';
import { formatVn, lastCompletedWindow, localInputToVnIso, todayWindow, validateWindow, vnIsoToLocalInput, yesterdayWindow } from '../../src/domain/timeWindow';
import { mergePatches, rootOf, secondariesOf } from '../../src/reports/assemble';
import { nextRun, SCHEDULE_SLOTS, type ScheduleSlot } from '../../src/domain/schedule';
import { uncertainStories, type UncertainStory } from '../../src/domain/suggest';
import { api, type CollectRun, type ExportFormat, type ExportResult, type ProfilesState, type TemplateOption, type RelevanceQuality, type RunInfo, type ServerStatus, type Vote } from './api';
import { SettingsDrawer } from './Settings';
import { STATE_LABEL, StateChip, useToast } from './ui';

type Tab = 'articles' | 'review' | 'coverage' | 'export';
const ASSESS: EditorialAssessment[] = ['needs_attention', 'positive', 'neutral'];
const ASSESS_COLOR: Record<EditorialAssessment, string> = { needs_attention: 'text-red-700 border-red-300 bg-red-50', positive: 'text-green-700 border-green-300 bg-green-50', neutral: 'text-slate-700 border-slate-300 bg-slate-50' };

export function App() {
  const toast = useToast();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [sources, setSources] = useState<Source[]>([]);
  const [online, setOnline] = useState(navigator.onLine);
  // after switching profile inside Settings the page reloads: reopen Settings on the same section
  const [reopenSection] = useState<string | null>(() => {
    try {
      const v = sessionStorage.getItem('reopenSettings');
      sessionStorage.removeItem('reopenSettings');
      return v;
    } catch {
      return null;
    }
  });
  const [settingsOpen, setSettingsOpen] = useState(!!reopenSection);
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
  // date/time editors open on "Tùy chỉnh" or a click on the window shown (closed otherwise: fewer controls on screen)
  const [editWindow, setEditWindow] = useState(false);
  const [to, setTo] = useState('');
  // profiles (cấu hình theo địa bàn): switching reloads everything for the chosen profile
  const [profiles, setProfiles] = useState<ProfilesState | null>(null);
  const activeProfile = profiles?.profiles.find((p) => p.id === profiles.activeId);
  const switchProfile = async (id: string) => {
    try {
      await api.activateProfile(id);
      window.location.reload();
    } catch (e) {
      toast('err', (e as Error).message);
    }
  };

  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => (window.removeEventListener('online', on), window.removeEventListener('offline', off));
  }, []);

  const applyPreset = useCallback((p: typeof preset, s: Settings) => {
    setPreset(p);
    const w = presetWindow(p, s);
    setFrom(vnIsoToLocalInput(w.from));
    setTo(vnIsoToLocalInput(w.to));
    return w;
  }, []);

  // several loads can be in flight (startup, run picker, live refresh): only the most recently requested run is shown,
  // otherwise a slow earlier load could display one period while the review is saved to another
  const lastLoad = useRef<string | null>(null);
  const shownWindowOf = useRef<string | null>(null);
  useEffect(() => {
    const r = runs.find((x) => x.runId === runId);
    if (!r || !settings || shownWindowOf.current === r.runId) return;
    shownWindowOf.current = r.runId;
    setFrom(vnIsoToLocalInput(r.window.from));
    setTo(vnIsoToLocalInput(r.window.to));
    const same = (p: 'last_completed' | 'today' | 'yesterday') => {
      const w = presetWindow(p, settings);
      return Date.parse(w.from) === Date.parse(r.window.from) && Date.parse(w.to) === Date.parse(r.window.to);
    };
    setPreset(latestRun(runs)?.runId === r.runId ? 'last_completed' : same('today') ? 'today' : same('yesterday') ? 'yesterday' : 'custom');
  }, [runId, runs, settings]);

  /** open a saved run (its window fills Từ / Đến) */
  const pickRun = (id: string) => {
    shownWindowOf.current = null;
    setRunId(id);
  };
  /** "Kỳ gần nhất" = the most recent collection (not a computed clock window); without any run: the last completed window */
  const pickLatest = (s: Settings) => {
    const l = latestRun(runs);
    if (!l) return applyPreset('last_completed', s);
    setPreset('last_completed');
    if (l.runId === runId) {
      setFrom(vnIsoToLocalInput(l.window.from));
      setTo(vnIsoToLocalInput(l.window.to));
    } else pickRun(l.runId);
  };
  /** "Lượt đã lưu" › Xoá (local: deleted; web: hidden for the team, restorable) */
  const removeRun = async (r: RunInfo) => {
    const local = api.mode === 'local';
    const msg = `Xoá lượt ${runLabel(r)}?\n\n` + (local ? 'Dữ liệu thu thập và kết quả duyệt của lượt này sẽ bị xoá khỏi máy (các báo cáo đã xuất vẫn giữ).' : 'Lượt này sẽ ẩn với cả nhóm; có thể khôi phục ở cuối danh sách "Lượt đã lưu".');
    if (!window.confirm(msg)) return;
    try {
      await api.deleteRun!(r.runId);
      const rs = await api.listRuns();
      setRuns(rs);
      if (r.runId === runId) {
        const l = latestRun(rs);
        if (l) pickRun(l.runId);
        else setRunId(null);
      }
      toast('ok', local ? 'Đã xoá lượt' : 'Đã xoá lượt (ẩn với cả nhóm)');
    } catch (e) {
      toast('err', (e as Error).message);
    }
  };
  const restoreRun = async (id: string) => {
    try {
      await api.restoreRun!(id);
      setRuns(await api.listRuns());
      toast('ok', 'Đã khôi phục lượt');
    } catch (e) {
      toast('err', (e as Error).message);
    }
  };
  const canDeleteRuns = !!api.deleteRun && (api.mode === 'local' || !!api.shared?.session());

  const loadRun = useCallback(async (id: string) => {
    lastLoad.current = id;
    const [r, c, a, rv] = await Promise.all([api.getRun(id), api.candidates(id), api.articles(id), api.review(id)]);
    if (lastLoad.current !== id) return;
    setRun(r);
    setCands(c);
    setArts(a);
    setReviews(rv);
  }, []);

  // startup: local state first, then optional auto-collect (once per window, server-enforced)
  useEffect(() => {
    (async () => {
      try {
        const [s, src, rs, pf] = await Promise.all([api.getSettings(), api.getSources(), api.listRuns(), api.profiles()]);
        setProfiles(pf);
        setSettings(s);
        setSources(src);
        setRuns(rs);
        // open the most recent collection (its window fills Từ/Đến, see the effect on runId); no collection yet → default window
        const first = latestRun(rs);
        if (!first) applyPreset(s.reportWindow.defaultPreset, s);
        if (first) {
          setRunId(first.runId);
          await loadRun(first.runId);
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

  // live (GitHub Pages) mode: show last update and check for a newer hourly dataset every 5 minutes
  const [live, setLive] = useState<{ generatedAt: string; schedule: string } | null>(null);
  useEffect(() => {
    if (api.mode !== 'live' || !api.meta) return;
    api.meta().then(setLive).catch(() => {});
    const t = setInterval(async () => {
      api.refresh?.();
      const m = await api.meta!().catch(() => null);
      if (!m) return;
      setLive((prev) => {
        if (prev && prev.generatedAt !== m.generatedAt) {
          toast('info', `Có dữ liệu mới (cập nhật ${formatVn(m.generatedAt)}) – đang tải lại`);
          api.listRuns().then((rs) => {
            setRuns(rs);
            if (rs[0]) setRunId(rs[0].runId);
            if (rs[0]) loadRun(rs[0].runId).catch(() => {});
          });
        }
        return m;
      });
    }, 5 * 60_000);
    return () => clearInterval(t);
  }, [loadRun, toast]);

  const windowIso = useMemo(() => {
    try {
      return { from: localInputToVnIso(from), to: localInputToVnIso(to) };
    } catch {
      return null;
    }
  }, [from, to]);
  const windowErr = windowIso ? validateWindow(windowIso) : 'Ngày giờ không hợp lệ';

  // "Thu thập" reacts at once (the request to the server / GitHub takes 1–3 s from Vietnam)
  const [starting, setStarting] = useState(false);
  const collect = async () => {
    if (!windowIso || windowErr || starting) return;
    if (api.mode === 'live' && api.shared && !api.shared.session()) {
      setLoginOpen(true);
      return;
    }
    // reuse a period that is already published for exactly this window (no need to collect again)
    if (api.mode === 'live') {
      const same = runs.find((x) => Date.parse(x.window.from) === Date.parse(windowIso.from) && Date.parse(x.window.to) === Date.parse(windowIso.to) && !x.notes.some((n) => /đang diễn ra/.test(n)));
      if (same && !confirm('Khung giờ này đã có dữ liệu trên web. Thu thập lại? (Kỳ này được cập nhật: giữ các bài đã đọc, tải thêm bài còn thiếu, phân loại lại theo cài đặt hiện tại)')) {
        setRunId(same.runId);
        return;
      }
    }
    setStarting(true);
    try {
      // remember the custom window (local/demo only; on the web settings are SHARED with the server collector)
      if (preset === 'custom' && settings && api.mode !== 'live') {
        const s2 = await api.saveSettings({ ...settings, reportWindow: { ...settings.reportWindow, customFrom: windowIso.from, customTo: windowIso.to } }, 'Lưu khung giờ tùy chỉnh');
        setSettings(s2);
      }
      const r = await api.startRun(windowIso, 'manual');
      if (r.remote) {
        setRemote({ from: windowIso.from, to: windowIso.to, at: Date.now(), status: 'đã gửi yêu cầu', url: null });
        toast('info', `Đã gửi yêu cầu thu thập ${formatVn(windowIso.from)} → ${formatVn(windowIso.to)} lên máy chủ thu thập (thường 5–10 phút)`);
        return;
      }
      if (r.runId) {
        setRunId(r.runId);
        toast('info', `Bắt đầu thu thập ${formatVn(windowIso.from)} → ${formatVn(windowIso.to)}`);
      }
    } catch (e) {
      toast('err', (e as Error).message);
    } finally {
      setStarting(false);
    }
  };

  const [saved, setSaved] = useState(0);
  const patch = async (articleId: string, p: Partial<ReviewDecision>) => {
    if (!run) return;
    // optimistic update: the control reacts immediately; reverted if the save fails
    const prev = reviews[articleId];
    setReviews((x) => ({ ...x, [articleId]: { ...(x[articleId] ?? { articleId, included: false, order: 0, updatedAt: '', changes: [] }), ...p } as ReviewDecision }));
    try {
      const r = await api.patchReview(run.runId, articleId, p);
      setReviews((x) => ({ ...x, [articleId]: r }));
      setSaved((n) => n + 1); // figures computed from the saved review (filter quality) refresh after the save, not before
      return true;
    } catch (e) {
      setReviews((x) => {
        const n = { ...x };
        if (prev) n[articleId] = prev;
        else delete n[articleId];
        return n;
      });
      toast('err', `Không lưu được: ${(e as Error).message}`);
      return false;
    }
  };

  // on-demand collection on GitHub Actions (web): follow the dispatched workflow run, then open the new period
  const [remote, setRemote] = useState<{ from: string; to: string; at: number; status: string; url: string | null } | null>(null);
  useEffect(() => {
    if (!remote || !api.shared) return;
    let stop = false;
    const tick = async () => {
      try {
        const st = await api.shared!.collectStatus();
        const run = st.runs.find((x) => (x.kind ? x.kind === 'request' : x.event === 'workflow_dispatch') && Date.parse(x.createdAt) >= remote.at - 90_000);
        if (!run) return setRemote((r) => (r ? { ...r, status: 'đang chờ máy chủ nhận yêu cầu' } : r));
        if (run.status !== 'completed') {
          return setRemote((r) => (r ? { ...r, status: run.status === 'queued' ? 'đang xếp hàng' : 'đang thu thập', url: run.url } : r));
        }
        if (run.conclusion !== 'success') {
          toast('err', `Lượt thu thập không thành công (${run.conclusion}). Xem chi tiết: ${run.url}`);
          return setRemote(null);
        }
        api.refresh?.();
        const rs = await api.listRuns();
        setRuns(rs);
        const hit = rs.find((x) => Date.parse(x.window.from) === Date.parse(remote.from) && Date.parse(x.window.to) === Date.parse(remote.to));
        if (!hit) return setRemote((r) => (r ? { ...r, status: 'đang cập nhật trang' } : r)); // Pages CDN can lag ~1 min
        setRunId(hit.runId);
        setRemote(null);
        toast('ok', `Đã thu thập xong ${formatVn(remote.from)} → ${formatVn(remote.to)}`);
      } catch (e) {
        setRemote((r) => (r ? { ...r, status: `lỗi kiểm tra tiến độ: ${(e as Error).message}` } : r));
      }
    };
    const t = setInterval(() => !stop && tick(), 20_000);
    tick();
    return () => {
      stop = true;
      clearInterval(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remote?.at]);

  // collection server (web): hourly automatic mode + whatever run is busy right now (visible to everyone)
  const [server, setServer] = useState<ServerStatus | null>(null);
  const loadServer = useCallback(async () => {
    if (!api.shared) return;
    try {
      setServer(await api.shared.serverStatus());
    } catch {
      /* status strip is informative only */
    }
  }, []);
  const serverRunning = (server?.running.length ?? 0) > 0;
  useEffect(() => {
    if (!api.shared) return;
    loadServer();
    const t = setInterval(loadServer, remote || serverRunning ? 15_000 : 60_000);
    return () => clearInterval(t);
  }, [loadServer, !!remote, serverRunning]);
  const busyRun: CollectRun | undefined = server?.running[0];
  // ticked fixed collection times of the active profile, e.g. "08:00, 16:30"
  const autoTimes = SCHEDULE_SLOTS.filter((s) => server?.profiles.find((x) => x.id === profiles?.activeId)?.schedule?.[s.id]).map((s) => s.at).join(', ');
  const toggleAuto = async (slot: ScheduleSlot, enabled: boolean) => {
    if (!api.shared) return;
    if (!api.shared.session()) return setLoginOpen(true);
    try {
      const prof = await api.shared.setSchedule(slot.id, enabled);
      setServer((s) => (s ? { ...s, profiles: s.profiles.map((x) => (x.id === prof.id ? prof : x)) } : s));
      toast('ok', `${enabled ? 'Đã BẬT' : 'Đã TẮT'} thu thập tự động lúc ${slot.at} cho cấu hình "${activeProfile?.name ?? ''}"`);
    } catch (e) {
      toast('err', (e as Error).message);
    }
  };

  // shared review (GitHub Pages): reviewer session + the team's votes for the current period
  const [reviewer, setReviewer] = useState(api.shared?.session() ?? null);
  const [loginOpen, setLoginOpen] = useState(false);
  const [votes, setVotes] = useState<Record<string, Vote[]>>({});
  const reloadVotes = useCallback(() => {
    if (!api.shared || !runId || !api.shared.session()) return setVotes({});
    api.shared.votes(runId).then(setVotes).catch((e) => toast('err', (e as Error).message));
  }, [runId, toast]);
  useEffect(() => {
    reloadVotes();
    // other reviewers' votes: refresh every 2 minutes (Cloudflare KV listings are eventually consistent, ~60 s)
    const t = setInterval(reloadVotes, 120_000);
    return () => clearInterval(t);
  }, [reloadVotes, reviewer]);
  // the team's shared review (selection, Sẵn sàng/Loại, edits): other reviewers' changes every minute and when the tab gets focus
  useEffect(() => {
    if (!api.shared || !runId) return;
    const id = runId;
    const pull = () => {
      if (document.visibilityState === 'visible') api.review(id).then((rv) => setReviews((cur) => (runIdRef.current === id ? rv : cur))).catch(() => {});
    };
    if (reviewer) pull(); // right after login: this browser's earlier decisions are shared once (api.review), the team's appear
    const t = setInterval(pull, 60_000);
    window.addEventListener('focus', pull);
    return () => {
      clearInterval(t);
      window.removeEventListener('focus', pull);
    };
  }, [runId, reviewer]);
  const runIdRef = useRef(runId);
  runIdRef.current = runId;
  /** in shared mode, labelling requires a reviewer session; the reviewer's own vote is shown immediately */
  const guardedPatch = async (articleId: string, p: Partial<ReviewDecision>) => {
    const reviewKeys = ['relevanceLabel', 'primaryCategory', 'assessment', 'reviewNote'];
    const s = api.shared?.session();
    // web: the review is the team's (selection, Sẵn sàng/Loại, edits too) → every change needs a reviewer session
    if (api.shared && !s) {
      setLoginOpen(true);
      return;
    }
    const before = reviews[articleId];
    const ok = await patch(articleId, p);
    if (ok && s && reviewKeys.some((k) => k in p)) {
      const cur = { ...(before ?? {}), ...p } as Partial<ReviewDecision>;
      const own: Vote = { r: s.name, l: cur.relevanceLabel ?? null, c: (cur.primaryCategory as string | null) ?? null, a: cur.assessment ?? null, n: (cur.reviewNote ?? '').slice(0, 200), t: new Date().toISOString() };
      setVotes((v) => {
        const others = (v[articleId] ?? []).filter((x) => x.r !== s.name);
        const empty = !own.l && !own.c && !own.a && !own.n;
        return { ...v, [articleId]: empty ? others : [...others, own] };
      });
    }
  };

  const merge = async (secondaryId: string, targetId: string) => {
    const ps = mergePatches(secondaryId, targetId, reviews);
    if (!ps.length) return toast('err', 'Không thể gộp: hai bài đã cùng một tin hoặc gộp vào chính nó');
    const ok = await Promise.all(ps.map((p) => patch(p.articleId, p.patch))); // one save on the web
    if (ok.every(Boolean)) toast('ok', 'Đã gộp nguồn vào tin');
  };
  const split = (secondaryId: string) => patch(secondaryId, { groupId: null });

  const artById = useMemo(() => new Map(arts.map((a) => [a.id, a])), [arts]);
  const candByArticle = useMemo(() => new Map(cands.filter((c) => c.articleId).map((c) => [c.articleId!, c])), [cands]);
  const inReviewQueue = (a: Article) => {
    const c = candByArticle.get(a.id);
    return !!c && (['date_unverified', 'parsed_partial'].includes(c.state) || (c.state === 'ready_for_review' && !!c.reasonCode));
  };
  // the editor can move a story from Cần kiểm tra to Bài sẵn sàng (and back)
  const readyPool = arts.filter((a) => (candByArticle.get(a.id)?.state === 'ready_for_review' && !candByArticle.get(a.id)?.reasonCode) || (inReviewQueue(a) && !!reviews[a.id]?.promotedToReady));
  const reviewPool = arts.filter((a) => inReviewQueue(a) && !reviews[a.id]?.promotedToReady);
  // stories the editor removed ("Loại") leave the lists; each tab lists its own under "Đã loại" to restore
  const isOut = (a: Article) => !!reviews[a.id]?.excludedByEditor;
  const ready = readyPool.filter((a) => !isOut(a));
  const reviewQueue = reviewPool.filter((a) => !isOut(a));
  const selected = Object.values(reviews).filter((r) => r.included).length;
  // "Hỏi nhanh": stories nobody judged yet that the filter is least sure about
  const askable = useMemo(() => {
    if (!settings || !arts.length) return [] as UncertainStory[];
    const skip = new Set(arts.filter((a) => { const r = reviews[a.id]; return !!(r?.relevanceLabel || r?.included || r?.excludedByEditor || r?.promotedToReady || r?.groupId || votes[a.id]?.length); }).map((a) => a.id));
    try {
      return uncertainStories(arts, settings, skip, 8);
    } catch {
      return [];
    }
  }, [arts, settings, reviews, votes]);
  const [asking, setAsking] = useState<UncertainStory[] | null>(null);
  const startAsk = () => {
    if (api.shared && !api.shared.session()) return setLoginOpen(true);
    setAsking(askable);
  };
  const answerAsk = async (x: UncertainStory, relevant: boolean) => {
    if (api.shared && !api.shared.session()) return (setLoginOpen(true), false);
    // ✗ on a ready story also takes it out of the list (as "✗ Không" does); ✓ on an excluded story records the miss
    await guardedPatch(x.article.id, relevant ? { relevanceLabel: 'relevant' } : x.status === 'relevant' ? { relevanceLabel: 'irrelevant', included: false, excludedByEditor: true, excludeReason: 'off_topic' } : { relevanceLabel: 'irrelevant' });
    return true;
  };

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-slate-200/80 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-[1500px] items-center gap-2 px-3 py-2 sm:gap-3 sm:px-4">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-navy-700 to-teal-600 text-sm font-bold text-white shadow-sm">ĐT</div>
          <h1 className="hidden max-w-[22rem] truncate text-[15px] font-bold text-navy-800 md:block" data-testid="app-subtitle" title={settings?.report.subtitle ?? ''}>
            {settings?.report.subtitle || 'Điểm tin báo chí'}
          </h1>
          {profiles && (
            <div className="relative ml-1 shrink-0" title="Địa bàn (cấu hình) – tạo mới/sao chép trong Cài đặt">
              <MapPin className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-teal-600" />
              <select className="cursor-pointer appearance-none rounded-full border border-slate-200 bg-slate-50 py-1.5 pl-7 pr-7 text-sm font-semibold text-slate-800 transition hover:border-teal-400" aria-label="Cấu hình (profile)" value={profiles.activeId} onChange={(e) => switchProfile(e.target.value)}>
                {profiles.profiles.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            </div>
          )}
          <span className="flex-1" />
          {/* one status dot instead of banners: live / demo / online, details on hover */}
          <span className="inline-flex shrink-0 items-center gap-2 rounded-full px-2 py-1 text-xs text-slate-500" title={api.mode === 'live' ? `DỮ LIỆU THẬT – ${autoTimes ? `tự động thu thập lúc ${autoTimes}` : 'tự động thu thập đang TẮT (chỉ thu thập khi bấm Thu thập)'}${live ? ` · cập nhật lúc ${formatVn(live.generatedAt)}` : ''}` : api.mode === 'demo' ? 'BẢN DEMO – dữ liệu mẫu thử, không phải tin thật' : online ? 'Có Internet' : 'Ngoại tuyến – xem/duyệt/xuất dữ liệu đã lưu'} data-testid="live-banner">
            <span className={`h-2.5 w-2.5 rounded-full ${!online ? 'bg-slate-400' : api.mode === 'demo' ? 'bg-amber-500' : 'dot-live bg-green-500'}`} />
            <span className="hidden lg:inline">{api.mode === 'live' && live ? <>Cập nhật <b className="font-semibold text-slate-700">{hhmm(live.generatedAt)}</b></> : !online ? 'Ngoại tuyến' : api.mode === 'demo' ? 'Bản demo' : 'Trực tuyến'}</span>
            <span className="sr-only">{api.mode === 'live' ? `DỮ LIỆU THẬT – ${autoTimes ? `tự động thu thập lúc ${autoTimes}` : 'tự động thu thập đang TẮT (chỉ thu thập khi bấm Thu thập)'}${live ? ` · cập nhật lúc ${formatVn(live.generatedAt)}` : ''}` : api.mode === 'demo' ? 'BẢN DEMO – dữ liệu mẫu thử, không phải tin thật' : online ? 'Có Internet' : 'Ngoại tuyến – xem/duyệt/xuất dữ liệu đã lưu'}</span>
          </span>
          {api.shared &&
            (reviewer ? (
              <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-teal-200 bg-teal-50 py-0.5 pl-0.5 pr-1 text-sm text-teal-900" data-testid="reviewer-chip" title={`Người duyệt: ${reviewer.name}`}>
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-teal-600 text-xs font-bold text-white">{initials(reviewer.name)}</span>
                <span className="hidden max-w-[10rem] truncate font-medium sm:inline">{reviewer.name}</span>
                <button className="rounded-full p-1 text-teal-700 transition hover:bg-teal-100" onClick={() => (api.shared!.logout(), setReviewer(null))} aria-label="Đăng xuất" title="Đăng xuất">
                  <LogOut className="h-3.5 w-3.5" />
                </button>
              </span>
            ) : (
              <button className="btn-teal shrink-0 rounded-full" onClick={() => setLoginOpen(true)} aria-label="Đăng nhập duyệt tin" title="Đăng nhập để duyệt tin và thu thập">
                <LogIn className="h-4 w-4" /> <span className="hidden sm:inline">Đăng nhập</span>
              </button>
            ))}
          <button className="btn-ghost shrink-0 rounded-full px-2.5" onClick={() => setSettingsOpen(true)} aria-label="Cài đặt" title="Cài đặt">
            <Cog className="h-4 w-4" /> <span className="hidden xl:inline">Cài đặt</span>
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-[1500px] space-y-4 px-3 py-4 sm:px-4">
        {api.mode === 'live' && !api.shared ? (
          <section className="card flex flex-wrap items-center gap-3 p-3" data-testid="live-periods">
            <RunPicker runs={runs} runId={runId} onPick={pickRun} />
            {run?.notes.some((x) => /đang diễn ra/.test(x)) && <span className="chip border-amber-300 bg-amber-50 text-amber-800">Kỳ chưa kết thúc – số liệu còn thay đổi</span>}
          </section>
        ) : (
        <section className="card animate-in relative z-20 p-3" data-testid="window-card">
          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            <div className="inline-flex rounded-full bg-slate-100 p-1" role="group" aria-label="Khung giờ">
              {([['last_completed', 'Kỳ gần nhất'], ['today', 'Hôm nay'], ['yesterday', 'Hôm qua'], ['custom', 'Tùy chỉnh']] as const).map(([k, l]) => (
                <button key={k} className={`rounded-full px-3 py-1.5 text-sm font-medium transition ${preset === k ? 'bg-navy-700 text-white shadow-sm' : 'text-slate-600 hover:bg-white hover:text-slate-900'}`} onClick={() => settings && (k === 'custom' ? (setPreset('custom'), setEditWindow(true)) : (setEditWindow(false), k === 'last_completed' ? pickLatest(settings) : applyPreset(k, settings)))}>
                  {l}
                </button>
              ))}
            </div>
            <button
              className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-semibold tabular-nums transition ${windowErr ? 'border-red-300 bg-red-50 text-red-700' : 'border-slate-200 bg-white text-slate-800 hover:border-teal-400'}`}
              onClick={() => setEditWindow((v) => !v)}
              aria-expanded={editWindow}
              title="Bấm để chọn ngày giờ (giờ Việt Nam; giờ kết thúc không tính)"
              data-testid="window-range"
            >
              <CalendarClock className="h-4 w-4 text-teal-600" />
              {windowIso ? `${shortVn(windowIso.from)} → ${shortVn(windowIso.to)}` : '—'}
              <ChevronDown className={`h-3.5 w-3.5 text-slate-400 transition ${editWindow ? 'rotate-180' : ''}`} />
            </button>
            <span className="flex-1" />
            {runs.length > 0 && <RunPicker runs={runs} runId={runId} onPick={pickRun} onDelete={canDeleteRuns ? removeRun : undefined} deleteHint={api.deleteRun && !canDeleteRuns ? 'Đăng nhập người duyệt để xoá' : undefined} onRestore={api.restoreRun && canDeleteRuns ? restoreRun : undefined} />}
            {run?.active ? (
              <button className="btn-danger rounded-full" onClick={() => api.cancel(run.runId)}>
                <Square className="h-4 w-4" /> Dừng
              </button>
            ) : (
              <button
                className="btn-primary rounded-full px-4 shadow-sm"
                disabled={starting || !!windowErr || !online || api.mode === 'demo' || (api.mode === 'live' && (!api.shared || !!remote || !!busyRun))}
                onClick={collect}
                title={
                  api.mode === 'live'
                    ? busyRun
                      ? 'Máy chủ đang chạy một lượt thu thập khác – nút mở lại khi lượt đó xong'
                      : 'Thu thập trên máy chủ (5–10 phút), tối đa 72 giờ mỗi lần; cần đăng nhập người duyệt'
                    : api.mode === 'demo'
                      ? 'Bản demo không thu thập báo thật'
                      : ''
                }
              >
                {starting ? <><RefreshCw className="h-4 w-4 animate-spin" /> Đang gửi…</> : <><Play className="h-4 w-4" /> Thu thập</>}
              </button>
            )}
          </div>
          {/* exact date/time: shown on demand */}
          <div className={editWindow ? 'animate-in mt-3 flex flex-wrap items-end gap-4 border-t border-slate-100 pt-3' : 'hidden'}>
            <DateTime24 label="Từ" value={from} onChange={(v) => (setFrom(v), setPreset('custom'))} />
            <DateTime24 label="Đến" value={to} onChange={(v) => (setTo(v), setPreset('custom'))} />
            {windowErr && <span className="pb-2 text-xs text-red-600">{windowErr}</span>}
          </div>
        </section>
        )}

        {api.shared && server && <ServerStrip server={server} profileId={profiles?.activeId ?? 'hcm'} remote={!!remote} onToggle={toggleAuto} />}

        {remote && (
          <section className="card animate-in flex flex-wrap items-center gap-3 border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900" data-testid="remote-collect">
            <RefreshCw className="h-4 w-4 animate-spin" />
            <span>
              Đang thu thập trên máy chủ: <b>{shortVn(remote.from)} → {shortVn(remote.to)}</b> · {remote.status}
            </span>
            <span className="text-xs text-blue-700">thường 5–10 phút, trang tự mở kết quả</span>
          </section>
        )}

        {run && askable.length > 0 && (
          <section className="card animate-in flex flex-wrap items-center gap-3 border-amber-200 bg-gradient-to-r from-amber-50 to-white px-4 py-2.5" data-testid="quick-ask">
            <HelpCircle className="h-5 w-5 text-amber-500" />
            <span className="text-sm">
              <b>Hỏi nhanh</b> · {askable.length} bài máy chưa chắc chắn <span className="text-slate-500">– chấm giúp vài giây để bộ lọc chính xác hơn mỗi ngày</span>
            </span>
            <span className="flex-1" />
            <button className="btn rounded-full border-amber-500 bg-amber-500 px-4 text-white hover:bg-amber-600" onClick={startAsk}>Bắt đầu</button>
          </section>
        )}
        {asking && <QuickAsk items={asking} onAnswer={answerAsk} onClose={() => setAsking(null)} />}

        {/* sources of the viewed period: one tile per publisher */}
        {run && <SourceStrip run={run} arts={arts} ready={ready} sources={sources} onOpen={() => setTab('coverage')} />}

        {!run ? (
          <div className="card animate-in flex flex-col items-center gap-2 p-10 text-center text-slate-500">
            <Inbox className="h-10 w-10 text-slate-300" />
            <p className="text-base font-medium text-slate-700">Chưa có dữ liệu</p>
            <p className="text-sm">Chọn khung giờ rồi bấm <b>Thu thập</b>.</p>
          </div>
        ) : (
          <>
            <nav className="flex flex-wrap gap-1 rounded-xl border border-slate-200 bg-slate-100/80 p-1" aria-label="Các mục">
              {(
                [
                  ['articles', 'Bài sẵn sàng', ready.length, CheckCircle2, 'bg-green-600 text-white', 'text-green-700'],
                  ['review', 'Cần kiểm tra', reviewQueue.length, AlertTriangle, reviewQueue.length ? 'bg-amber-500 text-white' : 'bg-slate-300 text-slate-700', 'text-amber-600'],
                  ['coverage', 'Độ phủ & nguồn', null, BarChart3, '', 'text-sky-700'],
                  ['export', 'Xuất báo cáo', selected, FileText, selected ? 'bg-navy-700 text-white' : 'bg-slate-300 text-slate-700', 'text-navy-700'],
                ] as const
              ).map(([k, l, n, Icon, badge, ic]) => (
                <button
                  key={k}
                  onClick={() => setTab(k)}
                  aria-current={tab === k ? 'page' : undefined}
                  aria-label={n !== null ? `${l} (${n})` : l}
                  className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition ${tab === k ? 'bg-white text-slate-900 shadow-sm ring-1 ring-slate-200' : 'text-slate-600 hover:bg-white/70 hover:text-slate-900'}`}
                >
                  <Icon className={`h-4 w-4 ${tab === k ? ic : 'text-slate-400'}`} />
                  {l}
                  {n !== null && (
                    <>
                      <span className="sr-only"> (</span>
                      <span className={`min-w-[1.5rem] rounded-full px-1.5 py-0.5 text-center text-xs font-bold tabular-nums ${badge}`}>{n}</span>
                      <span className="sr-only">)</span>
                    </>
                  )}
                </button>
              ))}
            </nav>
            {tab === 'articles' && <ArticleList list={ready} excluded={readyPool.filter(isOut)} reviews={reviews} cands={candByArticle} settings={settings} onInspect={setInspect} onPatch={guardedPatch} votes={votes} />}
            {tab === 'review' && <ArticleList list={reviewQueue} excluded={reviewPool.filter(isOut)} reviews={reviews} cands={candByArticle} settings={settings} onInspect={setInspect} onPatch={guardedPatch} reviewMode votes={votes} />}
            {tab === 'coverage' && <Coverage ledger={<Ledger cands={cands} sources={sources} onInspect={(aid) => setInspect(aid)} reviews={reviews} onPatch={patch} />} run={run} cands={cands} reviewsKey={`${saved}`} onOpenSettings={() => setSettingsOpen(true)} onRetry={async (body) => { try { const r = await api.retry(run.runId, body); setRunId(r.runId); toast('info', 'Đang chạy lại…'); } catch (e) { toast('err', (e as Error).message); } }} />}
            {tab === 'export' && settings && <ExportPanel run={run} arts={artById} reviews={reviews} settings={settings} onPatch={patch} onInspect={setInspect} onMerge={merge} onSplit={split} />}
          </>
        )}
      </main>
      {inspect && artById.get(inspect) && settings && (
        <Inspector a={artById.get(inspect)!} c={candByArticle.get(inspect)} r={reviews[inspect]} settings={settings} onClose={() => setInspect(null)} onPatch={(p) => guardedPatch(inspect, p)}
          arts={artById} reviews={reviews} onMerge={merge} onSplit={split} onOpen={setInspect} />
      )}
      {loginOpen && api.shared && (
        <ReviewerLogin
          onClose={() => setLoginOpen(false)}
          onLogin={async (name, code) => {
            await api.shared!.login(name, code);
            setReviewer(api.shared!.session());
            setLoginOpen(false);
            toast('ok', `Xin chào ${name} – các đánh giá của bạn được lưu chung cho cả nhóm`);
          }}
        />
      )}
      <SettingsDrawer
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        initialSection={(reopenSection ?? undefined) as Parameters<typeof SettingsDrawer>[0]['initialSection']}
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

/** Per-publisher summary of the viewed period (its last run): status, links found, extracted and ready stories, warnings. */
/** publisher home page from the source configuration (http/https only) */
function homeOf(sources: Source[], id: string): string | null {
  const u = sources.find((x) => x.id === id)?.baseUrl;
  try {
    return u && /^https?:$/.test(new URL(u).protocol) ? new URL(u).origin + '/' : null;
  } catch {
    return null;
  }
}

function SourceStrip({ run, arts, ready, sources, onOpen }: { run: RunInfo; arts: Article[]; ready: Article[]; sources: Source[]; onOpen: () => void }) {
  const live = run.notes?.some((x) => x.startsWith('Kỳ đang diễn ra'));
  const extracted = new Map<string, number>();
  for (const a of arts) extracted.set(a.sourceId, (extracted.get(a.sourceId) ?? 0) + 1);
  const readyBy = new Map<string, number>();
  for (const a of ready) readyBy.set(a.sourceId, (readyBy.get(a.sourceId) ?? 0) + 1);
  const DOT: Record<string, string> = { ok: 'bg-green-500', partial: 'bg-amber-500', failed: 'bg-red-500', running: 'bg-blue-500 animate-pulse', pending: 'bg-slate-300', cancelled: 'bg-slate-400' };
  const shown = run.sources.filter((s) => s.status !== 'skipped_disabled');
  const off = run.sources.length - shown.length;
  return (
    <section className="card animate-in p-3" data-testid="source-strip">
      <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1">
        <h2 className="text-sm font-semibold text-navy-800">Nguồn tin trong kỳ</h2>
        <span className="text-xs text-slate-400" data-testid="source-strip-caption" title={`${formatVn(run.window.from)} → ${formatVn(run.window.to)}${run.finishedAt ? ` · lượt cuối ${formatVn(run.finishedAt)}` : ''}`}>
          {run.finishedAt ? `cập nhật ${shortVn(run.finishedAt)}` : ''}
        </span>
        {run.active ? (
          <span className="chip border-blue-300 bg-blue-50 text-blue-800"><RefreshCw className="h-3 w-3 animate-spin" /> đang chạy</span>
        ) : live ? (
          <span className="chip border-sky-300 bg-sky-50 text-sky-800">đang diễn ra · cập nhật mỗi giờ</span>
        ) : api.mode === 'live' ? (
          <span className="chip border-slate-300 bg-slate-50 text-slate-600">kỳ đã chốt</span>
        ) : null}
        <button className="ml-auto inline-flex items-center gap-1 text-xs font-medium text-teal-700 hover:underline" onClick={onOpen}>Chi tiết <ArrowRight className="h-3 w-3" /></button>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {shown.map((s) => {
          const warn = [
            s.adapter?.status === 'degraded' && { t: 'bóc tách suy giảm', c: 'text-red-700', d: s.adapter.reasons.join('; ') },
            s.limitReached && { t: 'chạm giới hạn tải', c: 'text-amber-700', d: 'Còn link chưa tải trong lượt này (Cài đặt › Hiệu năng)' },
            s.status === 'failed' && { t: 'lỗi', c: 'text-red-700', d: s.error ?? '' },
          ].filter(Boolean) as Array<{ t: string; c: string; d: string }>;
          const home = homeOf(sources, s.sourceId);
          return (
            <div
              key={s.sourceId}
              className={`lift flex flex-col rounded-lg border bg-white ${warn.length ? 'border-amber-200' : 'border-slate-200'}`}
              data-testid={`source-tile-${s.sourceId}`}
            >
              {/* the publisher's name opens its home page (new tab); the rest of the tile opens the coverage details */}
              <div className="flex items-center gap-1.5 px-2.5 pt-2">
                <span className={`h-2 w-2 shrink-0 rounded-full ${DOT[s.status] ?? 'bg-slate-300'}`} />
                {home ? (
                  <a href={home} target="_blank" rel="noopener noreferrer" className="truncate text-sm font-semibold text-slate-800 hover:text-blue-700 hover:underline" title={`Mở trang chủ ${s.sourceName} (${home})`} data-testid={`source-home-${s.sourceId}`}>
                    {s.sourceName}
                  </a>
                ) : (
                  <span className="truncate text-sm font-semibold text-slate-800">{s.sourceName}</span>
                )}
              </div>
              <button
                onClick={onOpen}
                title={[`${s.sourceName}: ${SRC_STATUS[s.status] ?? s.status}`, ...warn.map((w) => `${w.t}${w.d ? ` – ${w.d}` : ''}`), 'Bấm để xem chi tiết độ phủ'].join('\n')}
                className="flex-1 px-2.5 pb-2 text-left"
              >
              <div className="mt-1 flex items-baseline gap-1">
                <span className="text-lg font-bold tabular-nums text-slate-800">{readyBy.get(s.sourceId) ?? 0}</span>
                <span className="text-[11px] text-slate-500">sẵn sàng</span>
              </div>
              <div className="text-[11px] tabular-nums text-slate-500">{s.candidates} link · {extracted.get(s.sourceId) ?? 0} bài đã đọc</div>
              <div className="mt-0.5 min-h-[1rem] text-[11px] font-medium">
                {warn.length ? (
                  warn.map((w) => <span key={w.t} className={`mr-1.5 ${w.c}`}>⚠ {w.t}</span>)
                ) : s.status === 'ok' ? (
                  <span className="text-green-700">✓ OK</span>
                ) : (
                  <span className={s.status === 'partial' ? 'text-amber-700' : 'text-slate-600'}>{SRC_STATUS[s.status] ?? s.status}</span>
                )}
              </div>
              </button>
            </div>
          );
        })}
      </div>
      {off > 0 && <p className="mt-1.5 text-[11px] text-slate-500">{off} nguồn đang tắt (Cài đặt › Nguồn tin).</p>}
    </section>
  );
}

/**
 * Date + time in 24-hour form on every computer (the browser's datetime-local follows the OS locale, e.g. AM/PM).
 * value / onChange: "YYYY-MM-DDTHH:mm" (local Vietnam time), like datetime-local.
 */
function DateTime24({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const [d = '', hm = '00:00'] = value.split('T');
  const [h = '00', m = '00'] = hm.slice(0, 5).split(':');
  const set = (nd: string, nh: string, nm: string) => nd && onChange(`${nd}T${nh}:${nm}`);
  const two = (n: number) => String(n).padStart(2, '0');
  return (
    // "Từ ngày [date]  Giờ [hh]:[mm]"
    <fieldset role="group" aria-label={label} className="flex items-end gap-2">
      <label>
        <span className="label">{label} ngày</span>
        <input type="date" className="input w-40" aria-label={`${label} – ngày`} value={d} onChange={(e) => set(e.target.value, h, m)} />
      </label>
      <div>
      <span className="label">Giờ</span>
      <div className="flex items-center gap-1">
        <select className="input w-16 px-1" aria-label={`${label} – giờ`} value={h} onChange={(e) => set(d, e.target.value, m)}>
          {Array.from({ length: 24 }, (_, i) => <option key={i} value={two(i)}>{two(i)}</option>)}
        </select>
        <span className="text-slate-500">:</span>
        <select className="input w-16 px-1" aria-label={`${label} – phút`} value={m} onChange={(e) => set(d, h, e.target.value)}>
          {Array.from({ length: 60 }, (_, i) => <option key={i} value={two(i)}>{two(i)}</option>)}
        </select>
      </div>
      </div>
    </fieldset>
  );
}

/**
 * "Vì sao?" – what the story matched when it was collected (the evidence stored with the article): places, the rule's
 * keywords and where they were found, sector scores, the words behind the suggested assessment, and – for stories that
 * are not ready – the reason. Read-only; nothing is recomputed.
 */
function MatchWhy({ a, reason }: { a: Article; reason?: string | null }) {
  const ev = a.relevance?.evidence ?? [];
  const places = new Map<string, string>();
  for (const e of [...(a.location?.evidence ?? []), ...ev]) {
    const m = /^Địa bàn: "(.+?)"(?: – (.*))?$/.exec(e);
    if (m && !places.has(m[1]!)) places.set(m[1]!, m[2] ?? '');
  }
  const kw = new Map<string, Set<string>>();
  for (const e of ev) {
    const m = /^Từ khóa "(.+?)" \((.+?)\)$/.exec(e);
    if (m) kw.set(m[1]!, (kw.get(m[1]!) ?? new Set()).add(m[2]!));
  }
  const sectors = (a.classificationEvidence ?? []).map((e) => {
    const off = /không tính/.test(e);
    const m = /^(.+?): (.+?)(?: \(điểm (\d+)\))?$/.exec(e);
    return { label: m?.[1] ?? e, words: off ? e.replace(/^.+?: /, '') : (m?.[2] ?? ''), score: Number(m?.[3] ?? 0), off };
  });
  const asm = (a.assessmentEvidence ?? []).filter((e) => !e.startsWith('Độ tin cậy'));
  const confidence = (a.assessmentEvidence ?? []).find((e) => e.startsWith('Độ tin cậy'));
  const other = ev.filter((e) => !/^(Địa bàn|Từ khóa|Bộ quy tắc)/.test(e));
  const where = (f: Set<string>) => [...f].map((x) => (x === 'tiêu đề' ? 'tiêu đề' : x === 'sapo' ? 'sapo' : 'nội dung')).join(', ');
  const row = (icon: string, label: string, body: React.ReactNode) => (
    <div className="flex gap-2">
      <span className="w-24 shrink-0 text-slate-500">{icon} {label}</span>
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1">{body}</div>
    </div>
  );
  return (
    <div className="animate-in mt-2 space-y-1.5 rounded-lg border border-slate-200 bg-slate-50 p-2.5 text-xs" data-testid="match-why">
      {reason && row('⚠', 'Lý do', <span className="text-amber-800">{reason}</span>)}
      {row('📍', 'Địa bàn', places.size ? [...places].map(([p, snip]) => <span key={p} className="chip border-green-200 bg-white text-green-800" title={snip}>{p}</span>) : <span className="text-slate-500">không thấy địa danh</span>)}
      {row('🔑', 'Từ khóa', kw.size ? [...kw].map(([k, f]) => (
        <span key={k} className={`chip bg-white ${f.has('tiêu đề') ? 'border-teal-300 font-semibold text-teal-800' : 'border-slate-200 text-slate-700'}`} title={`Có trong: ${where(f)}`}>
          {k} <span className="font-normal text-slate-400">· {where(f)}</span>
        </span>
      )) : <span className="text-slate-500">không khớp từ khóa nào</span>)}
      {sectors.length > 0 && row('🏷', 'Lĩnh vực', sectors.map((x, i) => (
        <span key={i} className={`chip bg-white ${x.off ? 'border-slate-200 text-slate-400 line-through' : i === 0 ? 'border-navy-200 font-semibold text-navy-800' : 'border-slate-200 text-slate-600'}`} title={x.off ? x.words : `Từ khóa: ${x.words}`}>
          {x.label}{x.score ? ` · ${x.score} điểm` : ''}
        </span>
      )))}
      {asm.length > 0 && row('⚖', 'Tính chất', <>
        {asm.map((e) => <span key={e} className="chip border-slate-200 bg-white text-slate-700">{e}</span>)}
        {confidence && <span className="text-slate-400">{confidence.replace('Độ tin cậy: ', 'độ tin cậy ')}</span>}
      </>)}
      {other.length > 0 && row('ℹ', 'Khác', <span className="text-slate-600">{other.join(' · ')}</span>)}
      <p className="text-[10px] text-slate-400">Theo cài đặt lúc thu thập bài. Từ khóa đậm = có trong tiêu đề (3 điểm), còn lại = sapo/nội dung (1 điểm).</p>
    </div>
  );
}

/**
 * "Loại" asks why in one click: off-topic / other area teach the filter; a duplicate or a minor story is on topic, so it
 * does not count against the filter (daily suggestions).
 */
function RemoveButton({ title, onRemove, className = '' }: { title: string; onRemove: (reason: ExcludeReason) => void; className?: string }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => (document.removeEventListener('mousedown', close), document.removeEventListener('keydown', close));
  }, [open]);
  const ICON: Record<ExcludeReason, string> = { off_topic: '🚫', other_area: '📍', duplicate: '⧉', minor: '↓' };
  return (
    <div className={`relative ${className}`} ref={box}>
      <button className="btn-ghost btn-xs text-red-700" onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-haspopup="menu" title="Loại bài này khỏi danh sách và báo cáo (khôi phục ở mục Đã loại bên dưới)" aria-label={`Loại bài: ${title}`}>
        <Trash2 className="h-3.5 w-3.5" /> Loại
      </button>
      {open && (
        <div className="animate-in absolute bottom-full right-0 z-20 mb-1 w-48 rounded-xl border border-slate-200 bg-white py-1 text-sm shadow-lg" role="menu" aria-label="Lý do loại">
          <div className="px-3 pb-1 pt-0.5 text-[11px] text-slate-500">Vì sao loại bài này?</div>
          {EXCLUDE_REASONS.map((k) => (
            <button key={k} role="menuitem" className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-slate-50" onClick={() => (setOpen(false), onRemove(k))}>
              <span className="w-4 text-center" aria-hidden="true">{ICON[k]}</span> {EXCLUDE_REASON_LABEL[k]}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** "Hỏi nhanh": one story at a time, the ones the filter is least sure about; every answer is a ✓/✗ vote of the team */
function QuickAsk({ items, onAnswer, onClose }: { items: UncertainStory[]; onAnswer: (x: UncertainStory, relevant: boolean) => Promise<boolean>; onClose: () => void }) {
  const [i, setI] = useState(0);
  const [done, setDone] = useState(0);
  const [busy, setBusy] = useState(false);
  const x = items[i];
  const answer = async (rel: boolean) => {
    if (!x) return;
    setBusy(true);
    try {
      if (await onAnswer(x, rel)) setDone((n) => n + 1);
      else return onClose();
    } finally {
      setBusy(false);
    }
    setI((n) => n + 1);
  };
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', k);
    return () => document.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-3" role="dialog" aria-modal="true" aria-label="Hỏi nhanh">
      <div className="animate-in w-full max-w-2xl rounded-2xl bg-white p-5 shadow-2xl">
        <div className="mb-3 flex items-center gap-2">
          <HelpCircle className="h-5 w-5 text-amber-500" />
          <h2 className="font-bold text-navy-800">Hỏi nhanh</h2>
          <span className="text-xs text-slate-500">{Math.min(i + 1, items.length)} / {items.length}</span>
          <div className="ml-2 h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-teal-500 transition-all" style={{ width: `${(Math.min(i, items.length) / items.length) * 100}%` }} /></div>
          <button className="btn-ghost rounded-full px-2" onClick={onClose} aria-label="Đóng hỏi nhanh"><X className="h-4 w-4" /></button>
        </div>
        {x ? (
          <div key={x.article.id} className="animate-in" data-testid="quick-ask-story">
            <p className="mb-2 rounded-lg bg-amber-50 px-3 py-1.5 text-xs text-amber-900">🤔 {x.why}</p>
            <div className="text-xs text-slate-500">{x.article.sourceName} · {x.article.publishedAt ? formatVn(x.article.publishedAt) : 'chưa rõ giờ đăng'} · hiện: <b>{x.status === 'relevant' ? 'Sẵn sàng' : x.status === 'review' ? 'Cần kiểm tra' : 'đã loại'}</b></div>
            <h3 className="mt-1 text-lg font-semibold leading-snug">{x.article.title}</h3>
            <p className="mt-1 line-clamp-4 text-sm text-slate-600">{x.article.sapo}</p>
            <a className="mt-1 inline-flex items-center gap-1 text-xs text-teal-700 hover:underline" href={x.article.canonicalUrl ?? x.article.originalUrl} target="_blank" rel="noreferrer"><ExternalLink className="h-3 w-3" /> Đọc bài gốc</a>
            <MatchWhy a={x.article} />
            <p className="mt-3 text-sm font-medium text-slate-700">Bài này có thuộc phạm vi điểm tin không?</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <button className="btn rounded-full border-green-600 bg-green-600 px-5 text-white hover:bg-green-700" disabled={busy} onClick={() => answer(true)}>✓ Liên quan</button>
              <button className="btn rounded-full border-red-600 bg-red-600 px-5 text-white hover:bg-red-700" disabled={busy} onClick={() => answer(false)}>✗ Không</button>
              <button className="btn-ghost rounded-full" disabled={busy} onClick={() => setI((n) => n + 1)}>Bỏ qua</button>
            </div>
          </div>
        ) : (
          <div className="animate-in flex flex-col items-center gap-2 py-6 text-center">
            <CheckCircle2 className="h-10 w-10 text-green-500" />
            <p className="font-semibold text-slate-800">Cảm ơn! Đã chấm {done} bài.</p>
            <p className="max-w-sm text-xs text-slate-500">Các phiếu này được dùng để gợi ý cải thiện bộ lọc mỗi đêm (Cài đặt › Gợi ý cải thiện).</p>
            <button className="btn-primary mt-2 rounded-full" onClick={onClose}>Xong</button>
          </div>
        )}
      </div>
    </div>
  );
}

/** "17:00 16/11" from an ISO time (Vietnam) */
function shortVn(iso: string): string {
  const [hm, d] = formatVn(iso).split(' ');
  return `${hm} ${(d ?? '').slice(0, 5)}`;
}
/** avatar letters: "Nguyễn Văn Cường" → "C", "Người duyệt D" → "D" */
function initials(name: string): string {
  const w = name.trim().split(/\s+/).filter(Boolean);
  return (w[w.length - 1]?.[0] ?? '?').toUpperCase();
}
/** compact run window: "16/11 · 08:01–16:30" (same day) or "15/11 17:00 → 16/11 08:00" */
function runLabel(r: { window: { from: string; to: string } }): string {
  const [fh, fd] = formatVn(r.window.from).split(' ');
  const [th, td] = formatVn(r.window.to).split(' ');
  const dm = (d?: string) => (d ?? '').slice(0, 5);
  return fd === td ? `${dm(fd)} · ${fh}–${th}` : `${dm(fd)} ${fh} → ${dm(td)} ${th}`;
}
/** requests sent for a reviewer by the assistant were recorded as "Claude (cho X)": shown as X */
function personName(s: string): string {
  return s.replace(/^Claude \(cho (.+)\)$/, '$1').trim();
}
/** who / how: "tự động", the reviewer who asked for it, "đang diễn ra", or a local status */
function runTag(r: RunInfo): { text: string; tone: string } {
  if (r.active) return { text: 'đang chạy', tone: 'border-blue-300 bg-blue-50 text-blue-800' };
  if (r.notes.some((x) => /đang diễn ra/i.test(x))) return { text: 'đang diễn ra', tone: 'border-sky-300 bg-sky-50 text-sky-800' };
  const sch = r.notes.map((x) => /theo lịch (\d{2}:\d{2})/.exec(x)).find(Boolean);
  if (sch) return { text: `lịch ${sch[1]}`, tone: 'border-teal-200 bg-teal-50 text-teal-800' };
  // "Thu thập theo yêu cầu (Cường)" / "… (Claude (cho Cường))" / "… của Cường trên web." → the requester
  const req = r.notes.map((x) => /theo yêu cầu(?: của)?\s*(.*)$/i.exec(x)).find(Boolean);
  if (req) {
    const who = personName((req[1] ?? '').replace(/\s*trên web\.?$/, '').replace(/^\((.*)\)$/, '$1').trim());
    return { text: who || 'theo yêu cầu', tone: 'border-violet-200 bg-violet-50 text-violet-800' };
  }
  if (r.status && r.status !== 'completed') return { text: STATUS_VN[r.status] ?? r.status, tone: 'border-amber-300 bg-amber-50 text-amber-800' };
  return { text: r.trigger === 'manual' ? 'thủ công' : 'tự động', tone: 'border-slate-200 bg-slate-50 text-slate-600' };
}
const STATUS_VN: Record<string, string> = { running: 'đang chạy', cancelled: 'đã dừng', failed: 'lỗi', partial: 'một phần', interrupted: 'bị ngắt' };

/** "Lượt đã lưu": compact list, newest first, current one ticked; delete per run; removed runs (web) can be restored */
function RunPicker({ runs, runId, onPick, onDelete, deleteHint, onRestore }: { runs: RunInfo[]; runId: string | null; onPick: (id: string) => void; onDelete?: (r: RunInfo) => void; deleteHint?: string; onRestore?: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const [removed, setRemoved] = useState<Array<{ run: RunInfo; by: string; at: string }> | null>(null);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => (document.removeEventListener('mousedown', close), document.removeEventListener('keydown', close));
  }, [open]);
  useEffect(() => {
    if (open && onRestore && api.hiddenRuns) api.hiddenRuns().then(setRemoved).catch(() => setRemoved(null));
  }, [open, onRestore, runs]);
  const at = (r: RunInfo) => Date.parse(r.finishedAt ?? r.createdAt) || 0;
  const sorted = [...runs].sort((a, b) => at(b) - at(a));
  const cur = runs.find((r) => r.runId === runId);
  const tag = cur && runTag(cur);
  return (
    <div className="relative" ref={box}>
      <button type="button" className="flex max-w-full items-center gap-2 whitespace-nowrap rounded-full border border-slate-200 bg-white px-3 py-1.5 text-left text-sm transition hover:border-teal-400" aria-label="Lượt đã lưu" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((v) => !v)} data-testid="run-picker" title="Lượt đã lưu">
        <History className="h-4 w-4 shrink-0 text-teal-600" />
        <span className="truncate font-medium tabular-nums">{cur ? runLabel(cur) : 'Chọn lượt…'}</span>
        {tag && <span className={`chip shrink-0 truncate ${tag.tone}`}>{tag.text}</span>}
        <ChevronDown className="ml-auto h-4 w-4 shrink-0 text-slate-500" />
      </button>
      {open && (
        <div className="animate-in absolute left-0 z-30 mt-1 max-h-96 w-[min(24rem,calc(100vw-2rem))] overflow-auto rounded-xl sm:left-auto sm:right-0 border border-slate-200 bg-white py-1 shadow-lg" role="listbox" aria-label="Danh sách các lượt">
          {sorted.map((r) => {
            const tg = runTag(r);
            const sel = r.runId === runId;
            return (
              <div key={r.runId} className={`group flex items-center gap-1 px-1 ${sel ? 'bg-navy-50' : 'hover:bg-slate-50'}`} data-testid={`run-row-${r.runId}`}>
                <button type="button" role="option" aria-selected={sel} className="flex min-w-0 flex-1 items-center gap-2 rounded px-2 py-1.5 text-left text-sm" onClick={() => (onPick(r.runId), setOpen(false))}>
                  <Check className={`h-3.5 w-3.5 shrink-0 ${sel ? 'text-navy-700' : 'invisible'}`} />
                  <span className="truncate tabular-nums">{runLabel(r)}</span>
                  <span className={`chip ml-auto shrink-0 ${tg.tone}`}>{tg.text}</span>
                </button>
                {onDelete ? (
                  <button type="button" className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-700 disabled:opacity-30" disabled={r.active} title={r.active ? 'Lượt đang chạy – dừng trước khi xoá' : 'Xoá lượt này'} aria-label={`Xoá lượt ${runLabel(r)}`} onClick={() => (setOpen(false), onDelete(r))}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                ) : deleteHint ? (
                  <span className="p-1.5 text-slate-300" title={deleteHint}><Trash2 className="h-3.5 w-3.5" /></span>
                ) : null}
              </div>
            );
          })}
          {!sorted.length && <p className="px-3 py-2 text-sm text-slate-500">Chưa có lượt nào.</p>}
          {onRestore && removed && removed.length > 0 && (
            <details className="mt-1 border-t border-slate-100 px-3 py-1.5 text-xs text-slate-600">
              <summary className="cursor-pointer select-none">Lượt đã xoá ({removed.length})</summary>
              {removed.map((x) => (
                <div key={x.run.runId} className="flex items-center gap-2 py-1">
                  <span className="truncate tabular-nums">{runLabel(x.run)}</span>
                  <span className="truncate text-slate-400">xoá bởi {x.by}</span>
                  <button type="button" className="ml-auto shrink-0 text-blue-700 underline" onClick={() => onRestore(x.run.runId)}>Khôi phục</button>
                </div>
              ))}
            </details>
          )}
        </div>
      )}
    </div>
  );
}

/** the most recent collection: latest finish (or start) time */
function latestRun<T extends { finishedAt: string | null; createdAt: string }>(rs: T[]): T | undefined {
  const at = (r: T) => Date.parse(r.finishedAt ?? r.createdAt) || 0;
  return [...rs].sort((a, b) => at(b) - at(a))[0];
}

/** window of a preset ("Kỳ gần nhất", "Hôm nay", "Hôm qua", saved custom) */
function presetWindow(p: 'last_completed' | 'today' | 'yesterday' | 'custom', s: Settings): { from: string; to: string } {
  const now = new Date();
  const { startClock: a, endClock: b } = s.reportWindow;
  return p === 'today' ? todayWindow(now, a, b) : p === 'yesterday' ? yesterdayWindow(now, a, b) : p === 'custom' && s.reportWindow.customFrom ? { from: s.reportWindow.customFrom, to: s.reportWindow.customTo } : lastCompletedWindow(now, a, b);
}

const SRC_STATUS: Record<string, string> = { ok: 'OK', partial: 'Một phần', failed: 'Lỗi', running: 'Đang chạy', pending: 'Chờ', skipped_disabled: 'Đã tắt', manual_only: 'Nhập thủ công', cancelled: 'Đã hủy' };


function ArticleList({ list, excluded = [], reviews, cands, settings, onInspect, onPatch, reviewMode, votes }: { list: Article[]; excluded?: Article[]; reviews: Record<string, ReviewDecision>; cands: Map<string, Candidate>; settings: Settings | null; onInspect: (id: string) => void; onPatch: (id: string, p: Partial<ReviewDecision>) => void | Promise<unknown>; reviewMode?: boolean; votes?: Record<string, Vote[]> }) {
  const [q, setQ] = useState('');
  const [bulk, setBulk] = useState<string | null>(null);
  const [cat, setCat] = useState<string>('all');
  // newest first by default (stories without a publication time last); the editor can flip it
  const [newestFirst, setNewestFirst] = useState(true);
  // "Vì sao?" panels open (several at once)
  const [why, setWhy] = useState<Set<string>>(new Set());
  const toggleWhy = (id: string) => setWhy((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const ts = (a: Article) => (a.publishedAt ? Date.parse(a.publishedAt) : NaN);
  const shown = list
    .filter((a) => (!q || a.title.toLowerCase().includes(q.toLowerCase())) && (cat === 'all' || (reviews[a.id]?.primaryCategory ?? a.primaryCategory) === cat))
    .sort((x, y) => {
      const a = ts(x), b = ts(y);
      if (Number.isNaN(a) || Number.isNaN(b)) return Number.isNaN(a) ? (Number.isNaN(b) ? 0 : 1) : -1;
      return newestFirst ? b - a : a - b;
    });
  const catLabel = (c: string | null | undefined) => settings?.categories.find((x) => x.code === c)?.label ?? 'Chưa phân loại';
  // bulk actions apply to the stories SHOWN (search + sector filter); stories merged into another one are skipped
  const selectable = shown.filter((a) => !reviews[a.id]?.groupId);
  const nSel = selectable.filter((a) => reviews[a.id]?.included).length;
  const runBulk = async (label: string, ids: string[], p: (id: string) => Partial<ReviewDecision>) => {
    setBulk(label);
    try {
      // all at once: every box changes immediately, the web saves them in ONE request (see api.queueTeamReview)
      await Promise.all(ids.map((id) => onPatch(id, p(id))));
    } finally {
      setBulk(null);
    }
  };
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
        <button className="btn-ghost btn-xs ml-auto" onClick={() => setNewestFirst((v) => !v)} title="Đổi thứ tự theo giờ đăng" data-testid="sort-toggle">
          {newestFirst ? <ArrowDown className="h-3.5 w-3.5" /> : <ArrowUp className="h-3.5 w-3.5" />} {newestFirst ? 'Mới nhất trước' : 'Cũ nhất trước'}
        </button>
      </div>
      {selectable.length > 0 && (
        <div className="mb-2 flex flex-wrap items-center gap-2 rounded border border-slate-200 bg-white px-3 py-2 text-sm" data-testid="bulk-bar">
          <label className="flex cursor-pointer items-center gap-2 font-medium">
            <input
              type="checkbox"
              className="h-4 w-4 accent-teal-600"
              aria-label="Chọn tất cả bài đang hiển thị"
              checked={nSel === selectable.length}
              ref={(el) => {
                if (el) el.indeterminate = nSel > 0 && nSel < selectable.length;
              }}
              disabled={!!bulk}
              onChange={(e) => {
                const on = e.target.checked;
                const ids = selectable.filter((a) => !!reviews[a.id]?.included !== on).map((a) => a.id);
                // each newly selected story gets its own place, in the order shown (same order → ↑/↓ could not swap them)
                const base = Date.now() % 1e9;
                void runBulk(on ? 'Đang chọn…' : 'Đang bỏ chọn…', ids, (id) => (on ? { included: true, order: base + ids.indexOf(id) } : { included: false }));
              }}
            />
            Chọn tất cả ({selectable.length}{shown.length < list.length ? ' đang hiển thị' : ''})
          </label>
          <span className="text-slate-500">· đã chọn {nSel}</span>
          {nSel > 0 && (
            <button className="btn-ghost btn-xs" disabled={!!bulk} onClick={() => void runBulk('Đang bỏ chọn…', selectable.filter((a) => reviews[a.id]?.included).map((a) => a.id), () => ({ included: false }))}>
              Bỏ chọn tất cả
            </button>
          )}
          {reviewMode && (
            <button
              className="btn-teal btn-xs ml-auto"
              disabled={!!bulk}
              title="Chuyển các bài đang hiển thị sang Bài sẵn sàng (bài chưa rõ giờ đăng vẫn phải xác nhận giờ trước khi xuất)"
              onClick={() => {
                const ids = (nSel > 0 ? selectable.filter((a) => reviews[a.id]?.included) : shown).map((a) => a.id);
                if (confirm(`Chuyển ${ids.length} bài${nSel > 0 ? ' đã chọn' : ' đang hiển thị'} sang Bài sẵn sàng?`)) void runBulk('Đang chuyển…', ids, () => ({ promotedToReady: true }));
              }}
            >
              <ArrowRight className="h-3.5 w-3.5" /> Chuyển {nSel > 0 ? `${nSel} bài đã chọn` : 'tất cả'} sang Bài sẵn sàng
            </button>
          )}
          {nSel > 0 && (
            <button
              className={`btn-danger btn-xs ${reviewMode ? '' : 'ml-auto'}`}
              disabled={!!bulk}
              title="Loại các bài đã chọn khỏi danh sách và báo cáo (khôi phục ở mục Đã loại bên dưới)"
              onClick={() => void runBulk('Đang loại…', selectable.filter((a) => reviews[a.id]?.included).map((a) => a.id), () => ({ excludedByEditor: true, included: false }))}
            >
              <Trash2 className="h-3.5 w-3.5" /> Loại {nSel} bài đã chọn
            </button>
          )}
          {bulk && <span className="text-xs text-slate-500">{bulk}</span>}
        </div>
      )}
      {shown.length === 0 && <div className="card p-6 text-center text-sm text-slate-500">{reviewMode ? 'Không có bài cần kiểm tra.' : 'Chưa có bài sẵn sàng trong khung giờ này.'}</div>}
      <div className="space-y-2">
        {shown.map((a) => {
          const r = reviews[a.id];
          const c = cands.get(a.id);
          const asm = r?.assessment ?? a.suggestedAssessment;
          const img = a.imageCandidates[0];
          return (
            <article key={a.id} className={`card animate-in flex gap-3 p-3 transition-shadow hover:shadow-md ${r?.included ? 'ring-2 ring-teal-500' : ''}`}>
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
                  {!reviewMode && r?.promotedToReady && <span className="chip border-sky-300 bg-sky-50 text-sky-800" title="Biên tập viên đã chuyển bài này từ Cần kiểm tra">từ Cần kiểm tra</span>}
                </div>
                <h3 className="font-semibold leading-snug">{r?.title ?? a.title}</h3>
                <p className="line-clamp-2 text-sm text-slate-600">{r?.summary ?? a.sapo}</p>
                {reviewMode && c?.reasonDetail && <p className="mt-1 text-xs text-amber-800">Lý do: {c.reasonDetail}</p>}
                <div className="mt-2 flex flex-wrap items-center gap-1 border-t border-slate-100 pt-2" data-testid="story-actions">
                  <button className="btn-ghost btn-xs" onClick={() => onInspect(a.id)}><FileText className="h-3.5 w-3.5" /> Xem chi tiết</button>
                  <a className="btn-ghost btn-xs" href={a.canonicalUrl ?? a.originalUrl} target="_blank" rel="noreferrer"><ExternalLink className="h-3.5 w-3.5" /> Bài gốc</a>
                  <button className={`btn-ghost btn-xs ${why.has(a.id) ? 'border-amber-300 bg-amber-50 text-amber-900' : ''}`} onClick={() => toggleWhy(a.id)} aria-expanded={why.has(a.id)} aria-label={`Vì sao bài này được lấy: ${a.title}`} title="Bài khớp tiêu chí nào: địa bàn, từ khóa, lĩnh vực, tính chất">
                    <Lightbulb className="h-3.5 w-3.5" /> Vì sao?
                  </button>
                  <RelevanceButtons r={r} onPatch={(p) => onPatch(a.id, p)} title={a.title} votes={votes?.[a.id]} />
                  {reviewMode && (
                    <button className="btn-teal btn-xs" onClick={() => onPatch(a.id, { promotedToReady: true })} title="Chuyển bài này sang Bài sẵn sàng" aria-label={`Chuyển sang Bài sẵn sàng: ${a.title}`}>
                      <ArrowRight className="h-3.5 w-3.5" /> Sẵn sàng
                    </button>
                  )}
                  {!reviewMode && r?.promotedToReady && (
                    <button className="btn-ghost btn-xs" onClick={() => onPatch(a.id, { promotedToReady: false })} title="Trả bài về Cần kiểm tra" aria-label={`Trả về Cần kiểm tra: ${a.title}`}>
                      <Undo2 className="h-3.5 w-3.5" /> Trả về
                    </button>
                  )}
                  {r?.sharedBy && (
                    <span className="ml-auto text-[11px] text-slate-500" title="Kết quả duyệt dùng chung cho cả nhóm" data-testid="shared-by">
                      duyệt chung: {r.sharedBy}{r.sharedAt ? ` · ${formatVn(r.sharedAt)}` : ''}
                    </span>
                  )}
                  <RemoveButton className={r?.sharedBy ? '' : 'ml-auto'} title={a.title} onRemove={(reason) => onPatch(a.id, { excludedByEditor: true, included: false, excludeReason: reason })} />
                </div>
                {why.has(a.id) && <MatchWhy a={a} reason={reviewMode ? c?.reasonDetail : null} />}
              </div>
            </article>
          );
        })}
      </div>
      {excluded.length > 0 && (
        <details className="mt-3 rounded border border-slate-200 bg-white p-2" data-testid="excluded-list">
          <summary className="cursor-pointer text-sm text-slate-600">Đã loại ({excluded.length}) – xem và khôi phục</summary>
          <div className="mt-2 space-y-1">
            {excluded.map((a) => (
              <div key={a.id} className="flex items-center gap-2 border-b border-slate-100 py-1 text-sm">
                <span className="text-xs text-slate-500">{a.sourceName}</span>
                <span className="min-w-0 flex-1 truncate">{reviews[a.id]?.title ?? a.title}</span>
                {reviews[a.id]?.relevanceLabel === 'irrelevant' && <span className="chip border-red-300 bg-red-50 text-red-800">không liên quan</span>}
                {reviews[a.id]?.excludeReason && <span className="chip border-slate-300 bg-slate-50 text-slate-700">{EXCLUDE_REASON_LABEL[reviews[a.id]!.excludeReason!]}</span>}
                <button className="btn-ghost btn-xs" onClick={() => onPatch(a.id, reviews[a.id]?.relevanceLabel === 'irrelevant' ? { excludedByEditor: false, excludeReason: null, relevanceLabel: null } : { excludedByEditor: false, excludeReason: null })} aria-label={`Khôi phục: ${a.title}`}>
                  <Undo2 className="h-3.5 w-3.5" /> Khôi phục
                </button>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

function ReviewerLogin({ onClose, onLogin }: { onClose: () => void; onLogin: (name: string, code: string) => Promise<void> }) {
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40" role="dialog" aria-modal="true" aria-label="Đăng nhập người duyệt">
      <form
        className="card w-full max-w-md space-y-3 p-5"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setErr(null);
          try {
            await onLogin(name, code.trim());
          } catch (x) {
            setErr((x as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <h2 className="text-lg font-bold text-navy-700">Đăng nhập duyệt tin</h2>
        <p className="text-xs text-slate-600">
          Đánh giá của bạn (liên quan / không, lĩnh vực, tính chất, ghi chú) được lưu chung cho nhóm và dùng để cải thiện bộ thu thập. Trong kho mã nguồn công khai, tên bạn được thay bằng mã ẩn danh; <b>ghi chú có thể được công khai</b>, đừng ghi thông tin cá nhân.
        </p>
        <label className="block">
          <span className="label">Họ tên</span>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} required maxLength={40} autoFocus />
        </label>
        <label className="block">
          <span className="label">Mã truy cập (do quản trị gửi)</span>
          <input className="input font-mono" value={code} onChange={(e) => setCode(e.target.value)} required placeholder="HCM-XXXX-XXXX" />
        </label>
        {err && <p className="text-sm text-red-700">{err}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={onClose}>Hủy</button>
          <button className="btn-primary" disabled={busy || !name.trim() || !code.trim()}>{busy ? 'Đang kiểm tra…' : 'Đăng nhập'}</button>
        </div>
      </form>
    </div>
  );
}

/** Editor feedback on the filter: explicit label; including an article in the report counts as "relevant". */
function RelevanceButtons({ r, onPatch, title, votes }: { r?: ReviewDecision; onPatch: (p: Partial<ReviewDecision>) => void; title: string; votes?: Vote[] }) {
  const l = r?.relevanceLabel ?? null;
  const implicit = !l && (r?.included || r?.groupId);
  const yes = votes?.filter((v) => v.l === 'relevant') ?? [];
  const no = votes?.filter((v) => v.l === 'irrelevant') ?? [];
  return (
    <div className="flex flex-wrap items-center gap-1" data-testid="relevance-buttons">
      {votes && votes.length > 0 && (
        <span className="order-last text-[11px] text-slate-600" title={votes.map((v) => `${v.r}: ${v.l === 'relevant' ? 'liên quan' : v.l === 'irrelevant' ? 'không' : '—'}${v.n ? ` (${v.n})` : ''}`).join('\n')}>
          Nhóm duyệt: <b className="text-green-700">✓{yes.length}</b> <b className="text-red-700">✗{no.length}</b>
        </span>
      )}
      <div className="flex gap-1">
        <button
          className={`btn btn-xs ${l === 'relevant' ? 'border-green-600 bg-green-600 text-white' : 'btn-ghost'}`}
          aria-pressed={l === 'relevant'}
          aria-label={`Liên quan: ${title}`}
          title="Đánh giá cho bộ lọc: bài này đúng chủ đề ngành xây dựng TP.HCM"
          onClick={() => onPatch({ relevanceLabel: l === 'relevant' ? null : 'relevant' })}
        >
          ✓ Liên quan
        </button>
        <button
          className={`btn btn-xs ${l === 'irrelevant' ? 'border-red-600 bg-red-600 text-white' : 'btn-ghost'}`}
          aria-pressed={l === 'irrelevant'}
          aria-label={`Không liên quan: ${title}`}
          title="Đánh giá cho bộ lọc: bài này không thuộc phạm vi điểm tin – đồng thời loại khỏi danh sách và báo cáo (khôi phục ở mục Đã loại)"
          onClick={() => onPatch(l === 'irrelevant' ? { relevanceLabel: null } : { relevanceLabel: 'irrelevant', included: false, excludedByEditor: true })}
        >
          ✗ Không
        </button>
      </div>
      {implicit && <span className="text-[11px] text-green-700">đã chọn vào báo cáo = liên quan</span>}
    </div>
  );
}

function QualityCard({ reviewsKey }: { reviewsKey: string }) {
  const [q, setQ] = useState<RelevanceQuality | null>(null);
  useEffect(() => {
    api.relevanceQuality().then(setQ).catch(() => setQ(null));
  }, [reviewsKey]);
  if (!q) return null;
  const pct = (x: number | null) => (x == null ? '—' : `${Math.round(x * 100)}%`);
  const t = q.total;
  return (
    <div className="card p-3 text-sm" data-testid="quality-card">
      <div className="flex flex-wrap items-baseline gap-4">
        <h3 className="font-semibold text-navy-700">Chất lượng bộ lọc (theo đánh giá biên tập viên)</h3>
        <span>Đã đánh giá: <b>{t.labelled}</b> bài · {q.runs.filter((r) => r.labelled).length}/{q.runs.length} lượt</span>
        <span>Độ chính xác tab Sẵn sàng: <b>{pct(q.precisionReady)}</b> ({t.ready.R} đúng / {t.ready.R + t.ready.N})</span>
        <span>Độ phủ (không bỏ sót): <b>{pct(q.recall)}</b></span>
      </div>
      <div className="mt-1 text-xs text-slate-600">
        Sẵn sàng: {t.ready.R} liên quan · {t.ready.N} không · Cần kiểm tra: {t.review.R} liên quan · {t.review.N} không · Bị loại nhưng biên tập viên đánh dấu liên quan: <b className={t.excluded.R ? 'text-red-700' : ''}>{t.excluded.R}</b>
      </div>
      {t.labelled === 0 && <p className="mt-1 text-xs text-slate-500">Chưa có đánh giá. Bấm "✓ Liên quan / ✗ Không" ở các bài, hoặc "Thực ra liên quan?" trong danh sách link (cuối mục Độ phủ & nguồn) cho bài bị loại; bài được chọn vào báo cáo tự tính là liên quan.</p>}
      {q.missed.length > 0 && (
        <details className="mt-2 text-xs" open>
          <summary className="cursor-pointer font-semibold text-red-800">Tin bị bộ lọc loại nhầm ({q.missed.length}) – dùng để chỉnh quy tắc</summary>
          <ul className="mt-1 list-disc pl-5">{q.missed.map((m) => <li key={m.runId + m.articleId}><a className="text-blue-700 underline" href={m.url} target="_blank" rel="noreferrer">{m.title}</a> <span className="text-slate-500">({m.source} · lý do loại: {m.reasonCode})</span></li>)}</ul>
        </details>
      )}
      {q.falseReady.length > 0 && (
        <details className="mt-1 text-xs">
          <summary className="cursor-pointer font-semibold text-amber-800">Tin lạc đề lọt vào tab Sẵn sàng ({q.falseReady.length})</summary>
          <ul className="mt-1 list-disc pl-5">{q.falseReady.map((m) => <li key={m.runId + m.articleId}>{m.title} <span className="text-slate-500">({m.source})</span></li>)}</ul>
        </details>
      )}
    </div>
  );
}

function Ledger({ cands, sources, onInspect, reviews, onPatch }: { cands: Candidate[]; sources: Source[]; onInspect: (articleId: string) => void; reviews: Record<string, ReviewDecision>; onPatch: (id: string, p: Partial<ReviewDecision>) => void }) {
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
                <td className="td whitespace-nowrap">
                  {c.articleId && <button className="btn-ghost btn-xs" onClick={() => onInspect(c.articleId!)}>Xem</button>}
                  {c.articleId && c.state === 'irrelevant_with_evidence' && (
                    <button
                      className={`btn btn-xs ml-1 ${reviews[c.articleId]?.relevanceLabel === 'relevant' ? 'border-green-600 bg-green-600 text-white' : 'btn-ghost'}`}
                      aria-pressed={reviews[c.articleId]?.relevanceLabel === 'relevant'}
                      title="Bộ lọc đã loại bài này – đánh dấu nếu thực ra là tin cần đưa vào điểm tin (dùng để đo bỏ sót)"
                      onClick={() => onPatch(c.articleId!, { relevanceLabel: reviews[c.articleId!]?.relevanceLabel === 'relevant' ? null : 'relevant' })}
                    >
                      {reviews[c.articleId]?.relevanceLabel === 'relevant' ? '✓ Liên quan (bị loại nhầm)' : 'Thực ra liên quan?'}
                    </button>
                  )}
                </td>
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

function Coverage({ run, cands, onRetry, onOpenSettings, reviewsKey, ledger }: { ledger: React.ReactNode; run: RunInfo; cands: Candidate[]; onRetry: (b: { mode: 'failed' | 'source' | 'expand'; sourceId?: string; extraLookbackHours?: number }) => void; onOpenSettings: () => void; reviewsKey: string }) {
  const rec = run.reconciliation;
  return (
    <div className="space-y-3">
      <QualityCard reviewsKey={reviewsKey} />
      <div className="card flex flex-wrap items-center gap-4 p-3 text-sm">
        <div>
          Đối soát link: <b>{rec?.accounted ?? '?'} / {rec?.total ?? '?'}</b> link có trạng thái {rec?.balanced ? <CheckCircle2 className="inline h-4 w-4 text-green-600" /> : <AlertTriangle className="inline h-4 w-4 text-red-600" />}
          {rec && rec.transient > 0 && <span className="text-amber-700"> · {rec.transient} đang xử lý</span>}
        </div>
        <div>
          Mức đầy đủ lượt chạy:{' '}
          <b className={run.completeness === 'complete_within_enumerated_scope' ? 'text-green-700' : 'text-amber-700'}>
            {run.completeness === 'complete_within_enumerated_scope' ? 'Đủ trong phạm vi đã liệt kê' : run.completeness === 'incomplete' ? 'Chưa đầy đủ (xem lỗi/giới hạn bên dưới)' : 'Chưa xác định'}
          </b>
        </div>
        <span className="flex-1" />
        <button className="btn-ghost" disabled={run.active || api.mode !== 'local'} onClick={() => onRetry({ mode: 'failed' })}><RefreshCw className="h-4 w-4" /> Thử lại link lỗi</button>
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
              <button className="btn-ghost btn-xs" disabled={run.active || api.mode !== 'local'} onClick={() => onRetry({ mode: 'source', sourceId: s.sourceId })}>Quét lại nguồn này</button>
              <button className="btn-ghost btn-xs" disabled={run.active || api.mode !== 'local'} onClick={() => onRetry({ mode: 'expand', sourceId: s.sourceId, extraLookbackHours: 12 })}>Mở rộng quét (+12 giờ)</button>
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs md:grid-cols-8">
              {[['Trang DS đã duyệt', `${s.listingPagesVisited}/${s.listingPageLimit}`], ['Link duy nhất', mine.length], ['Sẵn sàng', by('ready_for_review')], ['Bóc tách thiếu', by('parsed_partial')], ['Chưa rõ giờ', by('date_unverified')], ['Ngoài khung', by('outside_window')], ['Không liên quan', by('irrelevant_with_evidence')], ['Lỗi/chặn', by('fetch_failed') + by('blocked') + by('parse_failed')]].map(([l, v]) => (
                <div key={String(l)} className="rounded bg-slate-50 p-2"><div className="text-slate-500">{l}</div><div className="text-base font-semibold">{v}</div></div>
              ))}
            </div>
            {(s as any).newSinceLast !== undefined && <p className="mt-1 text-xs text-slate-500">Lần quét gần nhất thêm mới: {(s as any).newSinceLast} link</p>}
            {s.adapter && <AdapterHealthCard h={s.adapter} disabled={run.active || api.mode !== 'local'} onRescan={() => onRetry({ mode: 'source', sourceId: s.sourceId })} onOpenSettings={onOpenSettings} />}
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
      {/* every discovered link with its state and reason: kept (no silent omission), folded away from daily work */}
      <details className="card p-3" data-testid="all-links">
        <summary className="cursor-pointer select-none text-sm font-semibold text-navy-700">
          Tất cả link đã phát hiện ({cands.length}) <span className="font-normal text-slate-500">– xem lý do bị loại, đưa lại bài bị loại nhầm</span>
        </summary>
        <div className="mt-3">{ledger}</div>
      </details>
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
  // "Tồn tại cần khắc phục": unit suggested from the topic (Cài đặt › Báo cáo & mẫu › Đề xuất giao đơn vị)
  const suggested = suggestAssignment({ title, sapo: a.sapo }, settings);
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
              {(() => {
                const pub = (a as Article & { publicSections?: { paragraphs: number; headings: number; tables: number; figures: number } }).publicSections;
                const k = pub ?? {
                  paragraphs: a.contentSections.filter((s) => s.type === 'paragraph').length, headings: a.contentSections.filter((s) => s.type === 'heading').length,
                  tables: a.contentSections.filter((s) => s.type === 'table').length, figures: a.contentSections.filter((s) => s.type === 'figure').length,
                };
                return (
                  <div className="mt-1">
                    Bộ bóc tách: {a.extractionAdapterVersion} · {k.paragraphs} đoạn · {k.headings} tiêu đề phụ · {k.tables} bảng · {k.figures} ảnh
                    {pub && <div className="mt-1 text-slate-600">Kỳ này được đăng trước khi web có toàn văn bài – bấm "Mở bài gốc" để đọc đầy đủ (các lượt thu thập mới có đủ nội dung).</div>}
                  </div>
                );
              })()}
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
              <div className="block" data-testid="proposal-box">
                <label className="block">
                  <span className="label">Đề xuất giao đơn vị (DỰ THẢO – cần lãnh đạo duyệt)</span>
                  <textarea className="input" rows={2} placeholder={suggested.text} value={proposal} onChange={(e) => setProposal(e.target.value)} onBlur={save} aria-label="Đề xuất giao đơn vị" />
                </label>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-600">
                  <span>
                    Gợi ý{suggested.rule ? ` (nhóm "${suggested.rule}": ${suggested.evidence.slice(0, 4).join(', ')})` : ' (không khớp nhóm nào – câu chung)'}: <i>{suggested.text}</i>
                    {!proposal && ' – để trống thì báo cáo dùng gợi ý này.'}
                  </span>
                  {proposal !== suggested.text && (
                    <button className="btn-ghost btn-xs" onClick={() => (setProposal(suggested.text), onPatch({ title, summary, shortLabel: short, proposal: suggested.text }))}>Dùng gợi ý</button>
                  )}
                </div>
              </div>
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
            <div className="rounded border border-slate-200 bg-slate-50 p-2">
              <span className="label">Góp ý cho bộ lọc (vì sao bài này nên/không nên được thu thập, lĩnh vực đúng là gì…)</span>
              <div className="mb-1 flex gap-1">
                <RelevanceButtons r={r} onPatch={onPatch} title={a.title} />
              </div>
              <textarea className="input text-xs" rows={2} defaultValue={r?.reviewNote ?? ''} placeholder="Ví dụ: tin thể thao của Bộ Xây dựng, không phải tin ngành" onBlur={(e) => e.target.value !== (r?.reviewNote ?? '') && onPatch({ reviewNote: e.target.value.slice(0, 1000) })} aria-label="Ghi chú góp ý cho bộ lọc" />
            </div>
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
  const [formats, setFormats] = useState<ExportFormat[]>(settings.report.outputFormats);
  const [busy, setBusy] = useState(false);
  // report template: Department template from the Skill (default), 4 original designs, or the uploaded one
  const [tpls, setTpls] = useState<TemplateOption[]>([]);
  const [tplId, setTplId] = useState(settings.report.templateId);
  useEffect(() => {
    api.templates().then((r) => (setTpls(r.templates), setTplId((cur) => (r.templates.some((x) => x.id === cur) ? cur : r.defaultId)))).catch(() => setTpls([]));
  }, []);
  const sel = Object.values(reviews).filter((r) => r.included && !r.groupId).sort((a, b) => a.order - b.order || a.articleId.localeCompare(b.articleId));
  const go = async (dryRun: boolean) => {
    setBusy(true);
    try {
      const r = await api.exportRun(run.runId, formats, dryRun, tplId);
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
  /** ↑ / ↓ inside a group (as shown on the slides): swap, then number the group 1..n so equal old numbers cannot block the move */
  const move = (list: ReviewDecision[], i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= list.length) return;
    const next = [...list];
    [next[i], next[j]] = [next[j]!, next[i]!];
    const base = Math.min(...list.map((r) => r.order));
    next.forEach((r, k) => r.order !== base + k && onPatch(r.articleId, { order: base + k }));
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
                const i = list.indexOf(r);
                const nMerged = secondariesOf(r.articleId, reviews).length;
                const pubs = [a?.sourceName, ...secondariesOf(r.articleId, reviews).map((id) => arts.get(id)?.sourceName)].filter(Boolean);
                return (
                  <div key={r.articleId} className="mb-1 rounded border border-slate-200 p-2 text-sm">
                    <div className="flex items-center gap-2">
                      <button className="btn-ghost btn-xs disabled:opacity-30" disabled={i === 0} onClick={() => move(list, i, -1)} aria-label="Lên"><ArrowUp className="h-3 w-3" /></button>
                      <button className="btn-ghost btn-xs disabled:opacity-30" disabled={i === list.length - 1} onClick={() => move(list, i, 1)} aria-label="Xuống"><ArrowDown className="h-3 w-3" /></button>
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
        {/* every template visible at once (tick one) – not hidden in a drop-down */}
        <fieldset className="space-y-1.5" role="radiogroup" aria-label="Mẫu báo cáo" data-testid="template-picker">
          <legend className="label mb-1">Mẫu báo cáo ({tpls.length})</legend>
          {tpls.length === 0 && <p className="text-xs text-red-700">Không tải được danh sách mẫu – tải lại trang.</p>}
          {tpls.map((x) => {
            const on = x.id === tplId;
            return (
              <label key={x.id} className={`flex cursor-pointer items-start gap-2 rounded border p-2 text-sm ${on ? 'border-teal-600 bg-teal-50' : 'border-slate-200 hover:bg-slate-50'} ${x.available === false ? 'cursor-not-allowed opacity-50' : ''}`}>
                <input type="radio" name="report-template" className="mt-1" value={x.id} checked={on} disabled={x.available === false} onChange={() => setTplId(x.id)} aria-label={x.name} />
                <span className="min-w-0">
                  <span className="font-medium">{x.name}</span>
                  <span className="ml-1 text-xs text-slate-500">· {x.orientation === 'landscape' ? 'trang ngang 16:9' : 'A4 dọc'}{x.kind === 'original-pptx' ? ' · tệp PowerPoint gốc' : x.kind === 'upload' ? ' · tệp của bạn' : ''}{x.available === false ? ' · thiếu tệp' : ''}</span>
                  {on && <span className="mt-0.5 block text-xs text-slate-600" data-testid="template-info">{x.description}</span>}
                </span>
              </label>
            );
          })}
        </fieldset>
        <div className="flex gap-4">
          {(['pptx', 'docx', 'pdf'] as const).map((f) => (
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

const hhmm = (iso: string) => new Date(iso).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Ho_Chi_Minh' });
const RUN_KIND: Record<string, string> = { auto: 'lượt tự động theo lịch', request: 'lượt thu thập theo yêu cầu', deploy: 'cập nhật phần mềm & dữ liệu (sau khi đẩy mã mới)' };

/** web: hourly automatic switch + what the collection server is doing now */
function ServerStrip({ server, profileId, remote, onToggle }: { server: ServerStatus; profileId: string; remote: boolean; onToggle: (slot: ScheduleSlot, on: boolean) => void }) {
  const prof = server.profiles.find((p) => p.id === profileId);
  const next = nextRun(prof?.schedule, new Date());
  const run = server.running[0];
  const who = run?.kind === 'request' ? personName(/\((.*)\)(?:\s*\[[^\]]*\])?\s*$/.exec(run.title)?.[1] ?? '') || undefined : undefined;
  return (
    <section className="card animate-in flex flex-wrap items-center gap-x-5 gap-y-2 px-4 py-2.5 text-sm" data-testid="server-status">
      <span className="inline-flex items-center gap-1.5 font-semibold text-slate-700" title="Tự động thu thập theo giờ cố định cho địa bàn đang chọn">
        <AlarmClock className="h-4 w-4 text-teal-600" /> Tự động
      </span>
      <div className="flex flex-wrap items-center gap-4" data-testid="auto-schedule">
        {SCHEDULE_SLOTS.map((s) => (
          <Switch key={s.id} label={s.at} title={`${s.at} – ${s.label}`} ariaLabel={`Tự động lúc ${s.at}`} checked={!!prof?.schedule?.[s.id]} disabled={!server.collectEnabled} onChange={(on) => onToggle(s, on)} />
        ))}
      </div>
      <span className="text-xs text-slate-500" data-testid="auto-info" title={next ? 'Dữ liệu có sau khoảng 5–10 phút; máy chủ bận thì tự thử lại' : 'Chỉ thu thập khi có người bấm Thu thập'}>
        {next ? <>Tiếp: <b className="text-slate-700">{next.slot.at} {next.at.slice(8, 10)}/{next.at.slice(5, 7)}</b></> : 'Đang tắt'}
      </span>
      <span className="flex-1" />
      {run ? (
        <span className="inline-flex items-center gap-2 text-xs font-medium text-amber-800" data-testid="server-busy" title={!remote ? 'Nút Thu thập mở lại khi xong' : undefined}>
          <RefreshCw className="h-3.5 w-3.5 animate-spin" />
          Máy chủ đang {run.status === 'queued' ? 'xếp hàng' : 'chạy'}: {RUN_KIND[run.kind ?? 'deploy']}
          {who ? ` (${who})` : ''} · {hhmm(run.createdAt)}
        </span>
      ) : (
        <span className="inline-flex items-center gap-1.5 text-xs text-slate-500" data-testid="server-idle" title="Có thể bấm Thu thập">
          <span className="h-2 w-2 rounded-full bg-green-500" /> Máy chủ rảnh
        </span>
      )}
    </section>
  );
}

/** on/off switch (a real checkbox underneath: keyboard, screen readers and tests work as before) */
function Switch({ label, title, ariaLabel, checked, disabled, onChange }: { label: string; title?: string; ariaLabel: string; checked: boolean; disabled?: boolean; onChange: (on: boolean) => void }) {
  return (
    <label className={`inline-flex items-center gap-2 ${disabled ? 'opacity-50' : 'cursor-pointer'}`} title={title}>
      <span className="relative inline-flex h-5 w-9 shrink-0">
        <input type="checkbox" className="peer absolute inset-0 z-10 m-0 h-full w-full cursor-pointer opacity-0 disabled:cursor-not-allowed" aria-label={ariaLabel} checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
        <span className="absolute inset-0 rounded-full bg-slate-300 transition-colors peer-checked:bg-teal-600 peer-focus-visible:ring-2 peer-focus-visible:ring-teal-400 peer-focus-visible:ring-offset-1" />
        <span className="absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform peer-checked:translate-x-4" />
      </span>
      <span className="font-semibold tabular-nums text-slate-700">{label}</span>
    </label>
  );
}
