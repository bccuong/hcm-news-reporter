import places from './data/hcm_places.json';
import { SettingsSchema, SourceSchema, type LocationArea, type RuleGroup, type Settings, type Source } from './schemas.js';
import { slugify } from './text.js';

/**
 * Seed data derived from the user's existing Skill (reference/hcm-news-reporter-skill):
 *  - assets/websites.txt (site list), scripts/collect_candidates.py LISTS (listing/RSS routes the Skill author
 *    noted as "tried 15/11/2026"), _KW topic keywords, SKIP_SECTIONS, assets/hcm_places.json.
 * These are editable starting values in the GUI, not hardcoded behavior.
 */

const SKILL_ROUTES: Record<string, { name: string; base: string; routes: string[]; conc?: number; pause?: number; exclude?: string }> = {
  'thanhnien.vn': {
    name: 'Thanh Niên',
    base: 'https://thanhnien.vn',
    routes: ['/thoi-su.htm', '/thoi-su/dan-sinh.htm', '/kinh-te/dia-oc.htm', '/rss/thoi-su.rss', '/rss/kinh-te/dia-oc.rss', '/rss/home.rss'],
  },
  'vnexpress.net': {
    name: 'VnExpress',
    base: 'https://vnexpress.net',
    routes: ['/thoi-su', '/bat-dong-san', '/thoi-su/giao-thong', '/bat-dong-san/chinh-sach', '/tin-tuc-24h', '/rss/thoi-su.rss', '/rss/bat-dong-san.rss', '/rss/tin-moi-nhat.rss'],
  },
  'dantri.com.vn': {
    name: 'Dân trí',
    base: 'https://dantri.com.vn',
    routes: ['/rss/home.rss', '/rss/thoi-su.rss', '/rss/bat-dong-san.rss', '/thoi-su.htm', '/bat-dong-san.htm', '/thoi-su/giao-thong.htm', '/tin-moi-nhat.htm'],
    conc: 1,
    pause: 1500,
  },
  'tuoitre.vn': {
    name: 'Tuổi Trẻ',
    base: 'https://tuoitre.vn',
    routes: ['/thoi-su.htm', '/nha-dat.htm', '/tin-moi-nhat.htm', '/giao-thong.htm', '/rss/thoi-su.rss', '/rss/nha-dat.rss', '/rss/tin-moi-nhat.rss'],
  },
  'baoxaydung.vn': {
    name: 'Báo Xây dựng',
    base: 'https://baoxaydung.vn',
    routes: ['/', '/tin-moi.htm', '/bat-dong-san.htm', '/rss/home.rss'],
  },
  'sggp.org.vn': {
    name: 'Sài Gòn Giải Phóng',
    base: 'https://www.sggp.org.vn',
    routes: ['/', '/xahoi/', '/thoisu/', '/rss/home.rss', '/rss/xahoi-38.rss'],
    // daily print-edition pages ("Báo Sài Gòn Giải Phóng ngày 15/11/2026") are not articles
    exclude: '/bao-sai-gon-giai-phong-ngay-\\d+',
  },
};

export function sourceFromUrl(url: string, opts: Partial<Source> = {}): Source {
  const u = new URL(url);
  const host = u.hostname.replace(/^www\./, '');
  const known = SKILL_ROUTES[host];
  const base = known?.base ?? `${u.protocol}//${u.hostname}`;
  const abs = (p: string) => (p.startsWith('http') ? p : `${base}${p}`);
  const routes = known?.routes ?? [];
  const rss = routes.filter((r) => /\.rss$|\/rss\//.test(r)).map(abs);
  const sections = routes.filter((r) => !/\.rss$|\/rss\//.test(r)).map(abs);
  return SourceSchema.parse({
    id: slugify(host),
    name: known?.name ?? host,
    baseUrl: base,
    enabled: true,
    rssUrls: rss,
    sectionUrls: sections.length ? sections : [base + '/'],
    sitemapUrls: [],
    verifiedRoutes: known ? [...rss, ...sections] : [],
    excludeUrlPattern: known?.exclude ?? '',
    maxConcurrency: known?.conc ?? 2,
    pauseMs: known?.pause ?? 200,
    notes: known ? 'Tuyến thu thập lấy từ Skill gốc (đã thử 15/11/2026 theo ghi chú Skill).' : 'Nguồn mới – cần dò cấu trúc và kiểm tra.',
    origin: 'skill',
    ...opts,
  });
}

/** Parse the Skill's websites.txt format into draft sources (comments preserved as notes). */
export function parseWebsitesTxt(text: string): { sources: Source[]; comments: string[]; errors: string[] } {
  const sources: Source[] = [];
  const comments: string[] = [];
  const errors: string[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith('#')) {
      comments.push(line.replace(/^#\s*/, ''));
      continue;
    }
    const manual = /^web:\s*/i.test(line);
    const url = line.replace(/^web:\s*/i, '').trim();
    const withScheme = /^https?:\/\//i.test(url) ? url : `https://${url}`;
    try {
      const s = sourceFromUrl(withScheme, { origin: 'import' });
      if (manual) {
        s.fetchMode = 'manual_only';
        s.enabled = false;
        s.notes = `Skill ghi "web:" – báo chặn thu thập tự động từ máy chủ. ${comments.slice(-2).join(' ')}`.trim();
      }
      if (!sources.some((x) => x.id === s.id)) sources.push(s);
    } catch (e) {
      errors.push(`Dòng không hợp lệ: "${line}" (${(e as Error).message})`);
    }
  }
  return { sources, comments, errors };
}

const TOPIC_KEYWORDS = [
  'xây dựng', 'chung cư', 'nhà ở', 'bất động sản', 'quy hoạch', 'mặt bằng', 'bồi thường', 'thu hồi đất', 'tái định cư', 'metro',
  'đường sắt', 'cầu', 'nút giao', 'cao tốc', 'vành đai', 'giao thông', 'ùn tắc', 'kẹt xe', 'ngập', 'triều cường', 'mưa lớn', 'thoát nước',
  'hạ tầng', 'công trình', 'sạt lở', 'sụt lún', 'kênh', 'rạch', 'vỉa hè', 'căn hộ', 'sổ hồng', 'giấy phép', 'đô thị', 'xe buýt',
  'đầu tư công', 'giải ngân', 'sập', 'cây xanh', 'công viên', 'cống', 'đê', 'kè', 'thi công', 'dự án', 'nhà xưởng', 'đất đai',
];

const EXCLUDE_SECTIONS = ['the-thao', 'giai-tri', 'the-gioi', 'suc-khoe', 'du-lich', 'cong-nghe', 'so-hoa', 'van-hoa', 'giao-duc', 'khoa-hoc', 'bong-da'];

let n = 0;
const rid = (p: string) => `${p}_${++n}`;

export function defaultRulePreset(): { id: string; name: string; root: RuleGroup; sourceIds: string[] } {
  return {
    id: 'preset_nganh_xay_dung',
    name: 'Ngành xây dựng TP.HCM (mặc định từ Skill)',
    sourceIds: [],
    root: {
      kind: 'group',
      id: rid('g'),
      op: 'AND',
      negate: false,
      children: [
        {
          kind: 'group',
          id: rid('g'),
          op: 'OR',
          negate: false,
          children: TOPIC_KEYWORDS.map((k) => ({ kind: 'term' as const, id: rid('t'), field: 'any' as const, match: 'word' as const, value: k, negate: false })),
        },
        {
          kind: 'group',
          id: rid('g'),
          op: 'OR',
          negate: true,
          children: ['tuyển dụng', 'khuyến mãi', 'tour du lịch', 'xổ số'].map((k) => ({
            kind: 'term' as const, id: rid('t'), field: 'title' as const, match: 'phrase' as const, value: k, negate: false,
          })),
        },
      ],
    },
  };
}

function defaultAreas(): LocationArea[] {
  const areas: LocationArea[] = [
    {
      id: 'hcm',
      name: 'TP.HCM',
      kind: 'city',
      aliases: ['TPHCM', 'TP HCM', 'TP. HCM', 'TP Hồ Chí Minh', 'TP. Hồ Chí Minh', 'Thành phố Hồ Chí Minh', 'Sài Gòn', 'HCMC', 'Hồ Chí Minh'],
      requirePrefix: false,
    },
  ];
  const u = places.units as Record<string, string[]>;
  for (const w of u['phường'] ?? []) areas.push({ id: `p-${slugify(w)}`, name: w, kind: 'ward', aliases: [], requirePrefix: true });
  for (const w of u['xã'] ?? []) areas.push({ id: `x-${slugify(w)}`, name: w, kind: 'commune', aliases: [], requirePrefix: true });
  for (const w of u['đặc khu'] ?? []) areas.push({ id: `dk-${slugify(w)}`, name: w, kind: 'special_zone', aliases: ['đặc khu ' + w], requirePrefix: false });
  for (const l of places.landmarks) {
    const isDistrict = /^quận \d+/i.test(l);
    areas.push({ id: `l-${slugify(l)}`, name: l, kind: isDistrict ? 'legacy_district' : 'landmark', aliases: [], requirePrefix: false });
  }
  areas.push(
    { id: 'c-vanh-dai-3', name: 'Vành đai 3', kind: 'connected_area', aliases: ['đường Vành đai 3'], requirePrefix: false },
    { id: 'c-vanh-dai-4', name: 'Vành đai 4', kind: 'connected_area', aliases: [], requirePrefix: false },
    { id: 'c-long-thanh', name: 'sân bay Long Thành', kind: 'connected_area', aliases: ['cao tốc TP.HCM - Long Thành'], requirePrefix: false },
  );
  return areas;
}

export function defaultSettings(): Settings {
  return SettingsSchema.parse({
    keywords: {
      topicKeywords: TOPIC_KEYWORDS,
      synonyms: [
        { canonical: 'ùn tắc', aliases: ['kẹt xe', 'tắc đường', 'ùn ứ'] },
        { canonical: 'ngập', aliases: ['ngập nước', 'ngập úng', 'triều cường'] },
        { canonical: 'metro', aliases: ['đường sắt đô thị', 'tàu điện ngầm'] },
        { canonical: 'giải phóng mặt bằng', aliases: ['GPMB', 'bồi thường, hỗ trợ, tái định cư'] },
      ],
      excludePhrases: ['tuyển dụng', 'khuyến mãi', 'xổ số', 'pickleball', 'bóng đá', 'giải chạy', 'tennis', 'cầu lông', 'U23', 'U19', 'dự đoán tỷ số', 'giá vàng', 'giá USD'],
      excludeUrlSections: EXCLUDE_SECTIONS,
    },
    rules: { presets: [defaultRulePreset()], activePresetId: 'preset_nganh_xay_dung' },
    location: { areas: defaultAreas(), otherProvinces: places.other_provinces },
    categories: [
      { code: 'LAND', label: 'Đất đai', priority: 1, keywords: ['thu hồi đất', 'bồi thường', 'giải phóng mặt bằng', 'GPMB', 'quy hoạch sử dụng đất', 'tái định cư', 'đất đai', 'giá đất', 'quỹ đất'] },
      { code: 'BUILD', label: 'Xây dựng', priority: 2, keywords: ['xây dựng', 'công trình', 'giấy phép xây dựng', 'chất lượng công trình', 'an toàn', 'vi phạm', 'xây dựng trái phép', 'chung cư cũ', 'cấp D', 'thi công', 'công trường', 'sập'] },
      { code: 'INFRA', label: 'Hạ tầng kỹ thuật', priority: 3, keywords: ['thoát nước', 'cấp nước', 'hạ tầng', 'cống', 'vỉa hè', 'cây xanh', 'chiếu sáng', 'công viên', 'kè', 'kênh', 'rạch'] },
      { code: 'TRAFFIC', label: 'Giao thông', priority: 4, keywords: ['giao thông', 'metro', 'đường sắt', 'cầu', 'nút giao', 'cao tốc', 'vành đai', 'ùn tắc', 'kẹt xe', 'xe buýt', 'mở rộng đường'] },
      { code: 'REALESTATE', label: 'Bất động sản/nhà ở', priority: 5, keywords: ['bất động sản', 'nhà ở', 'chung cư', 'căn hộ', 'nhà ở xã hội', 'sổ hồng', 'dự án nhà ở', 'thị trường'] },
      { code: 'FLOOD', label: 'Ngập lụt', priority: 6, keywords: ['ngập', 'triều cường', 'mưa lớn', 'chống ngập', 'ngập úng', 'sạt lở', 'đê'] },
      { code: 'INVEST', label: 'Đầu tư công', priority: 7, keywords: ['đầu tư công', 'giải ngân', 'vốn đầu tư', 'chủ đầu tư', 'gói thầu'] },
      { code: 'POLICY', label: 'Chính sách, pháp quy', priority: 8, keywords: ['nghị định', 'thông tư', 'dự thảo', 'luật', 'nghị quyết', 'quyết định'] },
    ],
  });
}

export function defaultSources(websitesTxt: string): Source[] {
  return parseWebsitesTxt(websitesTxt).sources.map((s) => ({ ...s, origin: 'skill' as const }));
}
