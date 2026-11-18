import { z } from 'zod';

const clock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Giờ phải có dạng HH:mm');
const httpUrl = z
  .string()
  .trim()
  .url('URL không hợp lệ')
  .refine((u) => /^https?:\/\//i.test(u), 'Chỉ chấp nhận http(s)');

/**
 * Configurations saved before 16/11/2026 carry notes such as "(từ Skill)" – the Skill is only where the first defaults
 * came from, not something users need to see: removed when read.
 */
export function withoutSkillNote(s: string): string {
  return s
    .replace(/Tuyến thu thập lấy từ Skill gốc \(đã thử ([^)]*?) theo ghi chú Skill\)/g, 'Tuyến thu thập mặc định (đã thử $1)')
    .replace(/\(mặc định từ Skill\)/g, '(mặc định)')
    .replace(/\s*\((?:từ|trong) Skill\)/g, '')
    .replace(/ trong Skill(?=[:,.]|$)/g, '');
}

export const DiscoveryMethod = z.enum(['rss', 'sitemap', 'section', 'search']);
export type DiscoveryMethod = z.infer<typeof DiscoveryMethod>;

export const SourceSchema = z.object({
  id: z.string().min(1).regex(/^[a-z0-9-]+$/, 'Mã nguồn chỉ gồm a-z, 0-9, dấu gạch'),
  name: z.string().trim().min(1, 'Cần tên nguồn'),
  baseUrl: httpUrl,
  enabled: z.boolean().default(true),
  priority: z.number().int().min(1).max(99).default(10),
  /** direct = app fetches; manual_only = publisher blocks automated fetch, user pastes links */
  fetchMode: z.enum(['direct', 'manual_only']).default('direct'),
  discoveryMethods: z.array(DiscoveryMethod).default(['rss', 'sitemap', 'section']),
  rssUrls: z.array(httpUrl).default([]),
  sitemapUrls: z.array(httpUrl).default([]),
  sectionUrls: z.array(httpUrl).default([]),
  searchUrls: z.array(httpUrl).default([]),
  /** routes whose usefulness was verified by a human/test, vs auto-suggested hypotheses */
  verifiedRoutes: z.array(z.string()).default([]),
  crawlLimits: z
    .object({
      maxListingPages: z.number().int().min(1).max(500).default(30),
      maxDepth: z.number().int().min(0).max(10).default(2),
      maxArticleFetches: z.number().int().min(1).max(2000).default(300),
      /** articles per run for THIS publisher; null = the shared limit (Cài đặt › Hiệu năng). Big publishers (VnExpress) need more */
      perRunArticles: z.number().int().min(1).max(500).nullable().default(null),
      followPagination: z.boolean().default(true),
    })
    .default({}),
  maxConcurrency: z.number().int().min(1).max(8).default(2),
  pauseMs: z.number().int().min(0).max(30000).default(200),
  articleUrlPattern: z.string().default(''),
  excludeUrlPattern: z.string().default(''),
  notes: z.string().default('').transform(withoutSkillNote),
  origin: z.enum(['skill', 'user', 'import']).default('user'),
});
export type Source = z.infer<typeof SourceSchema>;

/** Boolean rule tree (visual builder). */
export type RuleTerm = {
  kind: 'term';
  id: string;
  field: 'any' | 'title' | 'body';
  match: 'word' | 'phrase' | 'substring';
  value: string;
  negate: boolean;
};
export type RuleGroup = {
  kind: 'group';
  id: string;
  op: 'AND' | 'OR';
  negate: boolean;
  children: RuleNode[];
};
export type RuleNode = RuleTerm | RuleGroup;

export const RuleTermSchema = z.object({
  kind: z.literal('term'),
  id: z.string(),
  field: z.enum(['any', 'title', 'body']).default('any'),
  match: z.enum(['word', 'phrase', 'substring']).default('word'),
  value: z.string().trim().min(1, 'Từ khóa không được rỗng'),
  negate: z.boolean().default(false),
});
export const RuleNodeSchema: z.ZodType<RuleNode> = z.lazy(() =>
  z.union([
    RuleTermSchema,
    z.object({
      kind: z.literal('group'),
      id: z.string(),
      op: z.enum(['AND', 'OR']),
      negate: z.boolean().default(false),
      children: z.array(RuleNodeSchema),
    }),
  ]),
) as z.ZodType<RuleNode>;

export const RulePresetSchema = z.object({
  id: z.string(),
  name: z.string().min(1).transform(withoutSkillNote),
  root: RuleNodeSchema,
  /** Optional: only applies to these sources (per-source override). Empty = all */
  sourceIds: z.array(z.string()).default([]),
});
export type RulePreset = z.infer<typeof RulePresetSchema>;

export const CategoryCode = z.enum(['LAND', 'BUILD', 'INFRA', 'TRAFFIC', 'REALESTATE', 'FLOOD', 'INVEST', 'POLICY']);
export type CategoryCode = z.infer<typeof CategoryCode>;

/** Sở Xây dựng TP.HCM guidance (16/11/2026): which unit handles which kind of "tồn tại cần khắc phục" */
export const ASSIGNMENT_RULES_DEFAULT = [
  { name: 'Mưa bão, ngập lụt, thoát nước, cây xanh', keywords: ['mưa bão', 'bão', 'mưa lớn', 'mưa dông', 'ngập', 'ngập lụt', 'ngập úng', 'triều cường', 'thoát nước', 'cống', 'cây xanh', 'cây đổ', 'gãy đổ', 'ngã đổ', 'gãy cành'], unit: 'Phòng Hạ tầng kỹ thuật, Trung tâm Quản lý giao thông và Hạ tầng kỹ thuật tham mưu, xử lý' },
  { name: 'Ùn tắc giao thông, kẹt xe', keywords: ['ùn tắc', 'kẹt xe', 'ùn ứ', 'tắc đường', 'kẹt cứng', 'tắc nghẽn'], unit: 'Trung tâm Quản lý điều hành giao thông đô thị tham mưu, xử lý' },
  { name: 'Huy động vốn, bán nhà ở hình thành trong tương lai', keywords: ['huy động vốn', 'nhà ở hình thành trong tương lai', 'hình thành trong tương lai', 'nhận cọc', 'góp vốn', 'bán nhà trên giấy'], unit: 'Phòng Phát triển đô thị tham mưu, xử lý' },
  { name: 'Chất lượng, hư hỏng, xuống cấp, sụp đổ công trình', keywords: ['chất lượng công trình', 'hư hỏng', 'xuống cấp', 'sụp đổ', 'sập', 'sụp', 'nứt', 'thấm dột', 'chung cư cũ', 'nguy hiểm'], unit: 'Phòng Quản lý chất lượng công trình tham mưu, xử lý' },
  { name: 'Xây dựng sai phép, trái phép, không phép', keywords: ['sai phép', 'trái phép', 'không phép', 'xây dựng trái phép', 'xây dựng không phép', 'sai giấy phép', 'trật tự xây dựng', 'lấn chiếm'], unit: 'Phòng Kiểm tra chuyên ngành tham mưu, xử lý' },
  { name: 'Hư hỏng mặt đường, ổ gà', keywords: ['ổ gà', 'ổ voi', 'mặt đường', 'hư hỏng mặt đường', 'sụt lún', 'lún sụt', 'bong tróc', 'hố sâu'], unit: 'Phòng Bảo trì và Khai thác công trình giao thông tham mưu, xử lý' },
] as const;

/** place-name look-alikes that are not about the city (user feedback 16/11/2026) */
export const LOCATION_EXCLUDE_DEFAULT = [
  'giải thưởng Hồ Chí Minh', 'đường Hồ Chí Minh', 'đường mòn Hồ Chí Minh', 'tư tưởng Hồ Chí Minh', 'Chủ tịch Hồ Chí Minh', 'lăng Chủ tịch Hồ Chí Minh', 'Bác Hồ',
  'Đoàn TNCS Hồ Chí Minh', 'Đội TNTP Hồ Chí Minh', 'Học viện Chính trị quốc gia Hồ Chí Minh', 'huân chương Hồ Chí Minh',
  'Sài Gòn - Hà Nội', 'Sài Gòn – Hà Nội', 'Hà Nội - TP HCM', 'Hà Nội - TP.HCM', 'Hà Nội - TPHCM', 'Hà Nội – TP.HCM', 'Hà Nội - Sài Gòn', 'Bắc - Nam',
];
/** regions that are not the city: named in a title without the city in title/sapo → other area */
export const OTHER_REGIONS_DEFAULT = ['miền Bắc', 'miền Trung', 'Bắc Bộ', 'Trung Bộ', 'Tây Nguyên', 'Bắc Trung Bộ', 'Nam Trung Bộ', 'sông Hồng'];
/** sports results / commodity prices: never construction news (title phrases; user feedback 16/11/2026) */
export const SPORTS_PRICES_EXCLUDE = ['đội tuyển', 'cầu thủ', 'thủ môn', 'khung thành', 'HLV', 'V-League', 'SEA Games', 'AFF Cup', 'Asian Cup', 'World Cup', 'vòng loại', 'giá heo hơi', 'giá xăng', 'giá cà phê', 'giá lúa gạo', 'lịch âm'];
/** sector categories of the construction & transport department (what "Chính sách, pháp quy" must be about) */
export const SECTOR_CODES: CategoryCode[] = ['LAND', 'BUILD', 'INFRA', 'TRAFFIC', 'REALESTATE', 'FLOOD', 'INVEST'];
/**
 * Defaults filled in when a stored configuration predates these fields (so saved web/local configs get them too;
 * the user can change them in Cài đặt › Lĩnh vực).
 */
/** the department's two industries: "Đầu tư công", "Chính sách, pháp quy" count only for them (user 17/11/2026) */
export const INDUSTRY_CODES: CategoryCode[] = ['BUILD', 'TRAFFIC'];
/** look-alikes of the "Hạ tầng kỹ thuật" words that are not urban technical infrastructure (replay on 1,021 stories, 17/11/2026) */
const INFRA_LOOKALIKES = [
  'hạ tầng số', 'hạ tầng sạc', 'hạ tầng viễn thông', 'hạ tầng dữ liệu', 'hạ tầng công nghệ', 'hạ tầng mạng', 'hạ tầng thanh toán', 'hạ tầng giao dịch', 'hạ tầng năng lượng',
  'kênh truyền hình', 'kênh YouTube', 'kênh đầu tư', 'kênh bán hàng', 'kênh phân phối', 'kênh thông tin', 'kênh huy động', 'kênh dẫn vốn', 'kênh tiết kiệm',
  'Rạch Giá', 'Rạch Dừa', 'Rạch Gầm', 'Rạch Sỏi',
];
export const CATEGORY_FIELD_DEFAULTS: Partial<Record<CategoryCode, { requiresCategories?: CategoryCode[]; excludePhrases?: string[] }>> = {
  POLICY: { requiresCategories: INDUSTRY_CODES },
  INVEST: { requiresCategories: INDUSTRY_CODES },
  INFRA: { excludePhrases: INFRA_LOOKALIKES },
  TRAFFIC: { excludePhrases: ['yêu cầu', 'nhu cầu', 'cung cầu', 'toàn cầu', 'cầu nguyện', 'cầu thị', 'cầu lông', 'cầu cứu', 'cầu hôn', 'cầu mong', 'cầu môn', 'khẩn cầu', 'mưu cầu'] },
  BUILD: { excludePhrases: ['sập bẫy', 'xây dựng Đảng', 'xây dựng chính quyền', 'xây dựng hệ thống chính trị', 'xây dựng gia đình', 'xây dựng văn hóa', 'xây dựng lực lượng', 'xây dựng pháp luật', 'xây dựng nông thôn mới', 'xây dựng đội ngũ', 'xây dựng thương hiệu', 'an toàn giao thông'] },
};
/** default keywords added in each revision – applied once to saved lists of an older revision */
export const KEYWORD_UPGRADES: Record<number, Partial<Record<CategoryCode, string[]>>> = {
  2: { TRAFFIC: ['đường bộ', 'đường thủy', 'sân bay', 'bến xe', 'cảng biển'] },
  // user's list 17/11/2026 + gaps found by replaying the filter on the team's labels
  3: {
    BUILD: ['sai phép', 'không phép', 'xây dựng sai phép', 'xây dựng không phép', 'trật tự xây dựng', 'vi phạm trật tự xây dựng', 'mất an toàn', 'an toàn công trình', 'quy hoạch đô thị', 'quy hoạch chung', 'quy hoạch phân khu', 'quy hoạch chi tiết', 'đồ án quy hoạch', 'chỉnh trang đô thị', 'phát triển đô thị'],
    FLOOD: ['mưa', 'ngập lụt'],
    REALESTATE: ['nhà xã hội', 'nhà xưởng'],
    TRAFFIC: ['CSGT', 'vi phạm giao thông', 'tai nạn giao thông', 'phạt nguội', 'an toàn giao thông'],
  },
  // a city master plan ('Quy hoạch tổng thể TP.HCM … tầm nhìn 100 năm') was excluded: 'quy hoạch' alone is too broad ('quy hoạch cán bộ')
  4: { BUILD: ['quy hoạch tổng thể', 'quy hoạch kiến trúc'] },
  // stories the team moved to "Sẵn sàng" on 18/11/2026 (Nghị định 168 / vượt đèn đỏ, xe máy xăng, giá cước vận tải)
  5: { TRAFFIC: ['đèn đỏ', 'Nghị định 168', 'xe máy', 'vận tải', 'giá cước'] },
};
/** default keywords that proved too broad – removed once from saved lists of an older revision */
export const KEYWORD_REMOVALS: Record<number, Partial<Record<CategoryCode, string[]>>> = {
  3: { BUILD: ['vi phạm', 'an toàn'] }, // "vi phạm" put a multi-level-marketing case in "Sẵn sàng"
};
/** excluded look-alike phrases added once to saved categories */
export const EXCLUDE_UPGRADES: Record<number, Partial<Record<CategoryCode, string[]>>> = {
  3: { INFRA: INFRA_LOOKALIKES },
  5: { BUILD: ['sập bẫy'] },
};
export const KEYWORDS_REV = 5;
/** "requiresCategories" revisions applied once to saved configurations (afterwards Cài đặt › Lĩnh vực decides) */
export const REQUIRES_UPGRADES: Record<number, Partial<Record<CategoryCode, CategoryCode[]>>> = {
  2: { POLICY: INDUSTRY_CODES, INFRA: INDUSTRY_CODES, INVEST: INDUSTRY_CODES },
  // the concrete urban-infrastructure words (công viên, cây xanh, thoát nước…) are the department's own field: "Công viên
  // Thiên niên kỷ TP.HCM vừa thu hồi" (in the department's sample report) was lost with the requirement; look-alikes are excluded instead
  3: { INFRA: [] },
};
export const REQUIRES_REV = 3;
const sameWord = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
export const CategorySchema = z.preprocess(
  (v) => {
    if (!v || typeof v !== 'object') return v;
    const o = v as Record<string, unknown>;
    const code = o.code as CategoryCode;
    const d = CATEGORY_FIELD_DEFAULTS[code] ?? {};
    // keyword upgrades: a saved list older than a revision receives that revision's new default keywords once
    // (approved by the user 16/11 and 17/11/2026); after that the user's own additions/removals are kept as they are
    let keywords = Array.isArray(o.keywords) ? (o.keywords as string[]) : undefined;
    let exclude = Array.isArray(o.excludePhrases) ? (o.excludePhrases as string[]) : undefined;
    const rev = typeof o.keywordsRev === 'number' ? o.keywordsRev : keywords ? 1 : KEYWORDS_REV;
    for (const r of [...new Set([...Object.keys(KEYWORD_UPGRADES), ...Object.keys(KEYWORD_REMOVALS), ...Object.keys(EXCLUDE_UPGRADES)].map(Number))].sort((a, b) => a - b)) {
      if (rev >= r) continue;
      if (keywords) {
        const drop = KEYWORD_REMOVALS[r]?.[code] ?? [];
        keywords = keywords.filter((k) => !drop.some((x) => sameWord(x, k)));
        const extra = KEYWORD_UPGRADES[r]?.[code] ?? [];
        keywords = [...keywords, ...extra.filter((k) => !keywords!.some((x) => sameWord(x, k)))];
      }
      if (exclude) {
        const extra = EXCLUDE_UPGRADES[r]?.[code] ?? [];
        exclude = [...exclude, ...extra.filter((k) => !exclude!.some((x) => sameWord(x, k)))];
      }
    }
    let requires = (o.requiresCategories as CategoryCode[] | undefined) ?? d.requiresCategories ?? [];
    const reqRev = typeof o.requiresRev === 'number' ? o.requiresRev : 1;
    for (const [r, set] of Object.entries(REQUIRES_UPGRADES)) if (reqRev < Number(r) && set[code]) requires = set[code]!;
    return { ...o, ...(keywords ? { keywords } : {}), keywordsRev: KEYWORDS_REV, requiresCategories: requires, requiresRev: REQUIRES_REV, excludePhrases: exclude ?? d.excludePhrases ?? [] };
  },
  z.object({
    code: CategoryCode,
    label: z.string().min(1),
    enabled: z.boolean().default(true),
    priority: z.number().int().min(1).max(99),
    keywords: z.array(z.string()).default([]),
    /** counted only when the title/sapo also names one of these categories (e.g. a decree must be about construction or transport) */
    requiresCategories: z.array(CategoryCode).default([]),
    /** phrases that contain a keyword but mean something else ("yêu cầu" is not a bridge) – removed before matching */
    excludePhrases: z.array(z.string()).default([]),
    /** keyword-list revision (see KEYWORD_UPGRADES) */
    keywordsRev: z.number().int().default(KEYWORDS_REV),
    /** requiresCategories revision (see REQUIRES_UPGRADES) */
    requiresRev: z.number().int().default(REQUIRES_REV),
  }),
);
export type Category = z.infer<typeof CategorySchema>;

export const LocationAreaSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  kind: z.enum(['city', 'ward', 'commune', 'special_zone', 'landmark', 'legacy_district', 'custom', 'connected_area']),
  aliases: z.array(z.string()).default([]),
  /** Ambiguous ward names (e.g. "Hòa Bình", "Sài Gòn") need a "phường"/"xã" prefix to count */
  requirePrefix: z.boolean().default(false),
});
export type LocationArea = z.infer<typeof LocationAreaSchema>;

/** topic words added 17/11/2026 (user's list + gaps found on the team's labels): to the topic keywords and the default rule */
export const TOPIC_ADDED_V2 = ['mưa', 'ngập lụt', 'sai phép', 'không phép', 'trái phép', 'chất lượng công trình', 'trật tự xây dựng', 'quy hoạch đô thị', 'chỉnh trang đô thị', 'nhà xã hội', 'CSGT', 'vi phạm giao thông', 'tai nạn giao thông', 'phạt nguội'];
/** title phrases excluded since 17/11/2026: "Điểm tin 21h: …" digests mix unrelated topics */
export const TITLE_EXCLUDE_ADDED_V2 = ['Điểm tin'];
/** since 18/11/2026: Báo Xây dựng's daily digest "Tin mới nhất, hay nhất trên Báo Xây dựng ngày 18/11" */
export const TITLE_EXCLUDE_ADDED_V3 = ['Tin mới nhất'];
const addMissing = (list: string[], extra: string[]) => [...list, ...extra.filter((k) => !list.some((x) => x.toLowerCase() === k.toLowerCase()))];
/** one-time upgrade of saved topic keywords / title exclusions (topicRev < 2) */
function upgradeKeywords(v: unknown) {
  if (!v || typeof v !== 'object') return v;
  const o = v as Record<string, unknown>;
  const rev = typeof o.topicRev === 'number' ? o.topicRev : 1;
  if (rev >= 3) return o;
  const topic = Array.isArray(o.topicKeywords) ? (o.topicKeywords as string[]) : [];
  const ex = Array.isArray(o.excludePhrases) ? (o.excludePhrases as string[]) : [];
  return {
    ...o,
    topicKeywords: rev < 2 ? addMissing(topic, TOPIC_ADDED_V2) : topic,
    excludePhrases: addMissing(rev < 2 ? addMissing(ex, TITLE_EXCLUDE_ADDED_V2) : ex, TITLE_EXCLUDE_ADDED_V3),
    topicRev: 3,
  };
}
/** one-time upgrade of the default rule ("Ngành xây dựng"): its first OR group receives the new topic words (presetRev < 2) */
function upgradeRules(v: unknown) {
  if (!v || typeof v !== 'object') return v;
  const o = v as Record<string, unknown>;
  if (typeof o.presetRev === 'number' && o.presetRev >= 2) return o;
  const presets = Array.isArray(o.presets) ? (o.presets as Array<Record<string, any>>) : [];
  const next = presets.map((p) => {
    const g = p.id === 'preset_nganh_xay_dung' && p.root?.kind === 'group' && p.root.op === 'AND' ? p.root.children?.[0] : null;
    if (!g || g.kind !== 'group' || g.op !== 'OR' || g.negate) return p;
    const have = new Set((g.children as Array<Record<string, any>>).filter((c) => c.kind === 'term').map((c) => String(c.value).toLowerCase()));
    const add = TOPIC_ADDED_V2.filter((k) => !have.has(k.toLowerCase())).map((k, i) => ({ kind: 'term', id: `t_v2_${i}`, field: 'any', match: 'word', value: k, negate: false }));
    return { ...p, root: { ...p.root, children: [{ ...g, children: [...g.children, ...add] }, ...p.root.children.slice(1)] } };
  });
  return { ...o, presets: next, presetRev: 2 };
}

export const SettingsSchema = z.object({
  schemaVersion: z.literal(3).default(3),
  locale: z.literal('vi-VN').default('vi-VN'),
  timezone: z.literal('Asia/Ho_Chi_Minh').default('Asia/Ho_Chi_Minh'),
  startup: z
    .object({
      autoCollectLastCompletedWindow: z.boolean().default(false),
      oncePerWindow: z.boolean().default(true),
    })
    .default({}),
  reportWindow: z
    .object({
      startClock: clock.default('17:00'),
      endClock: clock.default('08:00'),
      defaultPreset: z.enum(['last_completed', 'today', 'yesterday', 'custom']).default('today'),
      customFrom: z.string().default(''),
      customTo: z.string().default(''),
      lookbackMarginHours: z.number().min(0).max(72).default(6),
      dateField: z.literal('published').default('published'),
    })
    .default({}),
  discovery: z
    .object({
      enabledMethods: z.array(DiscoveryMethod).default(['rss', 'sitemap', 'section']),
      showIncompleteWarnings: z.boolean().default(true),
      earlyStopOnlyIfOrdered: z.boolean().default(true),
    })
    .default({}),
  collection: z
    .object({
      /** articles downloaded per publisher per run (all sources); a source may set a LOWER limit of its own */
      maxArticlesPerSource: z.number().int().min(1).max(2000).default(50),
      /**
       * links without any date (deep listing pages) are read newest publisher id first; after this many consecutive ones
       * verified OLDER than the window, the remaining undated links with smaller ids are recorded as outside the window
       * without download (reason OLDER_THAN_CHECKED, "Thử lại" still fetches them). 0 = off.
       */
      undatedStopAfterOld: z.number().int().min(0).max(100).default(8),
      maxConcurrentRequests: z.number().int().min(1).max(16).default(5),
      maxRequestsPerHost: z.number().int().min(1).max(8).default(2),
      timeoutMs: z.number().int().min(2000).max(120000).default(15000),
      maxRetries: z.number().int().min(0).max(6).default(2),
      backoffBaseMs: z.number().int().min(100).max(30000).default(1000),
      userAgent: z.string().default('HCMNewsReporter/0.1 (local editorial tool)'),
      respectRobotsTxt: z.boolean().default(true),
    })
    .default({}),
  keywords: z.preprocess(upgradeKeywords, z
    .object({
      topicKeywords: z.array(z.string()).default([]),
      /** topic-keyword revision (see upgradeKeywords) */
      topicRev: z.number().int().default(3),
      synonyms: z.array(z.object({ canonical: z.string().min(1), aliases: z.array(z.string()) })).default([]),
      excludePhrases: z.array(z.string()).default([]),
      excludeUrlSections: z.array(z.string()).default([]),
    })
    .default({})),
  rules: z.preprocess(upgradeRules, z
    .object({
      presets: z.array(RulePresetSchema).default([]),
      /** default-rule revision (see upgradeRules) */
      presetRev: z.number().int().default(2),
      activePresetId: z.string().default(''),
      /** When no rule/keyword matches: send to review queue instead of excluding */
      unknownRelevancePolicy: z.enum(['review', 'exclude_with_reason']).default('review'),
      /** title or sapo must contain a sector keyword (tuned on the 15/11/2026 live sample) */
      requireSectorInLead: z.boolean().default(true),
      /** safety net for the rule above: body sector score ≥ this → "Cần kiểm tra" instead of excluded (0 = off) */
      bodySectorScoreForReview: z.number().int().min(0).max(50).default(5),
    })
    .default({})),
  location: z
    .object({
      /** the profile's target area as shown to users ("TP.HCM", "Hà Nội", …); location status code "hcm" = inside it */
      regionName: z.string().min(1).max(60).default('TP.HCM'),
      areas: z.array(LocationAreaSchema).default([]),
      otherProvinces: z.array(z.string()).default([]),
      requireHcmEvidence: z.boolean().default(true),
      connectedAreasForReview: z.boolean().default(true),
      /** a connected area only in the body (no place of the city, the area not in title/sapo) → excluded with reason */
      connectedNeedsLead: z.boolean().default(true),
      /** no HCM area/alias/landmark at all → excluded with reason (visible in ledger) or review queue */
      noEvidencePolicy: z.enum(['review', 'exclude_with_reason']).default('exclude_with_reason'),
      /** HCM not in title/sapo: at least this many distinct HCM places in the body to be "ready" (else review) */
      minBodyAreasWithoutLead: z.number().int().min(1).max(10).default(2),
      /** phrases that contain a place name but are not about the place ("giải thưởng Hồ Chí Minh", "ngân hàng Sài Gòn - Hà Nội") – ignored when looking for evidence */
      excludePhrases: z.array(z.string()).default([...LOCATION_EXCLUDE_DEFAULT]),
      /**
       * no place evidence at all: kept for review only with strong sector evidence in title + sapo
       * (keyword in title = 3, only in sapo = 1; e.g. "chống ngập" in title + "ngập" = 6) or a sector policy/law. 3 = one title keyword is enough.
       */
      noPlaceMinLeadScore: z.number().int().min(1).max(20).default(4),
      /**
       * no place of the city at all: keep (Cần kiểm tra) only sector-wide policy / law and national sector news
       * ('policy_only', default since 17/11/2026: "không xác định được địa điểm tại HCM thì lọc ra trước, trừ chính sách,
       * pháp quy chung cho toàn ngành"), or also stories with strong sector words in the lead ('strong_sector', the old rule)
       */
      noPlaceKeep: z.enum(['policy_only', 'strong_sector']).default('policy_only'),
      /** words of a general policy / law / national programme: with a clear sector word in the lead, a story without a place is kept */
      policyPhrases: z.array(z.string()).default(['luật', 'dự thảo', 'nghị định', 'thông tư', 'nghị quyết', 'quy định', 'chính sách', 'Chính phủ', 'Thủ tướng', 'Phó Thủ tướng', 'Quốc hội', 'cả nước', 'toàn quốc', 'đường sắt tốc độ cao']),
      /** national news of the sector itself (ministry events, sector-wide programmes): kept for review even without a place */
      /**
       * national stories (sector policy without a place, or naming the city only in passing in the body) whose TITLE has a
       * sector keyword go to "Bài sẵn sàng" (off: "Cần kiểm tra"). The team moved them there by hand (18/11/2026).
       */
      nationalToReady: z.boolean().default(true),
      /** …except when the title has one of these (foreign news, stock market, crime, accidents elsewhere): they stay in "Cần kiểm tra" */
      nationalBlockWords: z.array(z.string()).default(['Trung Quốc', 'Nhật Bản', 'Hàn Quốc', 'Singapore', 'Thái Lan', 'châu Âu', 'quốc tế', 'nước ngoài', 'cổ phiếu', 'chứng khoán', 'khởi tố', 'lừa đảo', 'chiếm đoạt', 'tử vong', 'thương vong']),
      nationalSectorPhrases: z.array(z.string()).default(['ngành Xây dựng', 'Bộ Xây dựng', 'Bộ trưởng Bộ Xây dựng', 'Bộ trưởng Trần Hồng Minh', 'toàn ngành xây dựng']),
    })
    .default({}),
  categories: z.array(CategorySchema).default([]),
  quality: z
    .object({
      minBodyChars: z.number().int().min(0).max(20000).default(600),
      minParagraphs: z.number().int().min(0).max(100).default(3),
      jsonLdMismatchRatio: z.number().min(0).max(1).default(0.25),
      flagMissingTables: z.boolean().default(true),
      flagMissingCaptions: z.boolean().default(true),
      flagPagination: z.boolean().default(true),
      unknownPublicationTimeRequiresReview: z.literal(true).default(true),
    })
    .default({}),
  editorial: z
    .object({
      reviewPolicy: z.literal('manual_review_required').default('manual_review_required'),
      realPhotosOnly: z.literal(true).default(true),
      photoPolicy: z.enum(['strict_verified_only', 'review_then_use', 'link_only']).default('review_then_use'),
      noImagePolicy: z.enum(['text_only', 'block_slide']).default('text_only'),
      maxImagesPerArticle: z.number().int().min(0).max(5).default(2),
      minImageWidth: z.number().int().min(100).max(4000).default(400),
      summaryMaxChars: z.object({ TT: z.number().default(260), TC: z.number().default(260), TL: z.number().default(330) }).default({}),
      /** "Tồn tại cần khắc phục": suggested unit by topic (title keyword = 3, sapo = 1; strongest rule wins) */
      assignmentRules: z
        .array(z.object({ name: z.string().max(80), keywords: z.array(z.string()).default([]), unit: z.string().min(1).max(300) }))
        .default(() => ASSIGNMENT_RULES_DEFAULT.map((r) => ({ ...r, keywords: [...r.keywords] }))),
      /** when no rule matches */
      assignmentFallback: z.string().max(300).default('giao các phòng, đơn vị tham mưu theo chức năng, nhiệm vụ.'),
    })
    .default({}),
  report: z.preprocess(
    (v) => {
      // Word export (16/11/2026): a saved config from before it, with the old default ["pptx"], gets "docx" ticked once
      if (!v || typeof v !== 'object') return v;
      const o = v as Record<string, unknown>;
      // rev 3 (16/11/2026): .pptx + .docx always ticked by default (a shared web config had saved an empty list);
      // the PDF now comes from the app's own PDF builder unless PowerPoint/LibreOffice was chosen explicitly
      if (typeof o.outputFormatsRev !== 'number' || o.outputFormatsRev < 3) {
        const cur = Array.isArray(o.outputFormats) ? (o.outputFormats as string[]) : [];
        return { ...o, outputFormats: [...new Set(['pptx', 'docx', ...cur])], outputFormatsRev: 3, pdfRenderer: o.pdfRenderer === undefined || o.pdfRenderer === 'auto' ? 'builtin' : o.pdfRenderer };
      }
      return o;
    },
    z.object({
      organization: z.string().default('SỞ XÂY DỰNG THÀNH PHỐ HỒ CHÍ MINH – VĂN PHÒNG SỞ'),
      /** subtitle under the app name, e.g. "Điểm tin báo chí ngành xây dựng TP.HCM" */
      subtitle: z.string().max(120).default('Điểm tin báo chí ngành xây dựng TP.HCM'),
      /** default report template (built-in id, see src/reports/templates.ts); the export dialog can pick another */
      templateId: z.string().default('skill-so-xay-dung'),
      templateFile: z.string().default(''),
      /** files produced by "Xuất báo cáo": PowerPoint, Word (Department .docx template), PDF of the PowerPoint */
      outputFormats: z.array(z.enum(['pptx', 'docx', 'pdf'])).default(['pptx', 'docx']),
      outputFormatsRev: z.number().int().default(3),
      filenamePattern: z.string().default('HCM_Diem_tin_{date}_{from}-{to}'),
      storiesPerPage: z.number().int().min(1).max(4).default(2),
      overflowPolicy: z.enum(['new_slide', 'warn_only']).default('new_slide'),
      /** builtin = the app's own PDF (src/reports/pdf.ts, no Office needed); the others convert the PowerPoint file */
      pdfRenderer: z.enum(['builtin', 'auto', 'powerpoint', 'libreoffice', 'none']).default('builtin'),
      libreOfficePath: z.string().default(''),
      powerPointPath: z.string().default(''),
      contactEmail: z.string().default(''),
    }),
  ).default({}),
  performance: z
    .object({
      httpCacheMinutes: z.number().int().min(0).max(1440).default(30),
      keepRunsDays: z.number().int().min(1).max(3650).default(90),
    })
    .default({}),
});
export type Settings = z.infer<typeof SettingsSchema>;

/* ------------------------- Profiles (cấu hình theo địa bàn) ------------------------- */
/**
 * A profile = one complete collector configuration (settings + sources) for one target area, e.g. TP.HCM (default),
 * Hà Nội, Đà Nẵng. Profiles are created blank (from the defaults, for a new region) or cloned from an existing one.
 */
export const DEFAULT_PROFILE_ID = 'hcm';
export const ProfileIdSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/, 'Mã cấu hình: chữ thường không dấu, số, gạch nối');
export const ProfileMetaSchema = z.object({
  id: ProfileIdSchema,
  name: z.string().trim().min(1).max(60),
  description: z.string().max(300).default('').transform(withoutSkillNote),
  /** web: hourly automatic collection for this profile (the default TP.HCM profile is on) */
  autoCollect: z.boolean().default(false),
  clonedFrom: z.string().nullable().default(null),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ProfileMeta = z.infer<typeof ProfileMetaSchema>;
export const NewProfileSchema = z.object({
  name: z.string().trim().min(1).max(60),
  description: z.string().max(300).default(''),
  /** clone this profile's settings + sources; otherwise start from the defaults for a new region */
  cloneFrom: ProfileIdSchema.nullable().default(null),
  /** new (blank) profile: target area name and its other spellings, e.g. "Hà Nội", ["TP Hà Nội", "Thủ đô"] */
  regionName: z.string().trim().max(60).default(''),
  regionAliases: z.array(z.string().trim().min(1)).default([]),
});
export type NewProfile = z.infer<typeof NewProfileSchema>;

/* ------------------------- Collection records ------------------------- */

export const CandidateState = z.enum([
  'discovered',
  'fetch_queued',
  'fetched',
  'parsed_complete',
  'parsed_partial',
  'date_unverified',
  'outside_window',
  'irrelevant_with_evidence',
  'duplicate',
  'blocked',
  'fetch_failed',
  'parse_failed',
  'retry_pending',
  'ready_for_review',
  'reviewed',
]);
export type CandidateState = z.infer<typeof CandidateState>;

export const TERMINAL_STATES: CandidateState[] = [
  'outside_window',
  'irrelevant_with_evidence',
  'duplicate',
  'blocked',
  'fetch_failed',
  'parse_failed',
  'ready_for_review',
  'reviewed',
  'date_unverified',
  'parsed_partial',
  'retry_pending',
];

export interface DiscoveryEvidence {
  method: DiscoveryMethod | 'manual';
  listingUrl: string;
  at: string;
  feedPublishedAt?: string | null;
  feedTitle?: string;
}

export interface Candidate {
  id: string; // sha of canonical
  runId: string;
  sourceId: string;
  url: string;
  canonicalUrl: string | null;
  discoveredVia: DiscoveryEvidence[];
  discoveredAt: string;
  state: CandidateState;
  reasonCode: string | null;
  reasonDetail: string | null;
  httpStatus: number | null;
  attempts: number;
  attemptedAt: string | null;
  parserVersion: string | null;
  articleId: string | null;
  history: Array<{ at: string; state: CandidateState; reason?: string | null }>;
}

export type SectionType = 'heading' | 'paragraph' | 'list_item' | 'table' | 'figure' | 'quote' | 'factbox';
export interface ContentSection {
  ordinal: number;
  type: SectionType;
  text: string;
  level?: number;
  rows?: string[][];
  caption?: string;
  evidence: string; // selector / source
}

export interface DateEvidence {
  field: 'published' | 'modified';
  source: 'meta' | 'jsonld' | 'visible' | 'feed' | 'url_hint' | 'time_tag';
  raw: string;
  value: string | null;
}

export interface ImageCandidate {
  url: string;
  caption?: string;
  credit?: string;
  sourceArticleUrl: string;
  origin: 'og:image' | 'jsonld' | 'body';
  localCachePath?: string;
  rightsStatus: 'verified' | 'review' | 'not_usable';
  width?: number;
  height?: number;
}

export type EditorialAssessment = 'needs_attention' | 'positive' | 'neutral';

export interface Article {
  id: string;
  runId: string;
  sourceId: string;
  sourceName: string;
  originType: 'website' | 'docx' | 'manual';
  originalUrl: string;
  canonicalUrl: string | null;
  title: string;
  sapo: string;
  bodyText: string;
  contentSections: ContentSection[];
  articleLinks: string[];
  author: string | null;
  publishedAt: string | null;
  modifiedAt: string | null;
  collectedAt: string;
  dateConfidence: 'verified' | 'inferred' | 'unknown';
  dateEvidence: DateEvidence[];
  extractionAdapterVersion: string;
  /** body container selector actually used (adapter-drift detection) */
  extractionContainer?: string | null;
  extractionCompleteness: 'auto_checks_passed' | 'partial' | 'failed';
  extractionWarnings: string[];
  continuation: { detected: boolean; urls: string[] };
  location: { status: 'hcm' | 'connected' | 'other_province' | 'unknown'; evidence: string[] };
  relevance: { status: 'relevant' | 'review' | 'irrelevant'; score: number; evidence: string[] };
  primaryCategory: CategoryCode | null;
  secondaryCategories: CategoryCode[];
  classificationEvidence: string[];
  suggestedAssessment: EditorialAssessment | null;
  assessmentEvidence: string[];
  imageCandidates: ImageCandidate[];
  duplicateGroupId: string | null;
  warnings: string[];
}

export interface ReviewDecision {
  articleId: string;
  included: boolean;
  order: number;
  title?: string;
  summary?: string;
  shortLabel?: string;
  primaryCategory?: CategoryCode | null;
  assessment?: EditorialAssessment | null;
  proposal?: string;
  primaryImageUrl?: string | null;
  extractionMarkedComplete?: boolean;
  timeVerifiedManually?: boolean;
  groupId?: string | null;
  /** editor's relevance verdict (feeds precision/recall of the filter) */
  relevanceLabel?: 'relevant' | 'irrelevant' | null;
  /** reviewer's note to the developers (why the filter/classification was wrong) */
  reviewNote?: string;
  /** editor moved the story from "Cần kiểm tra" to "Bài sẵn sàng" (export checks such as an unverified time still apply) */
  promotedToReady?: boolean;
  /** editor removed the story from the lists ("Loại"; restorable under "Đã loại") – never deletes collected data */
  excludedByEditor?: boolean;
  /** why it was removed: only off-topic / other area teach the filter (a duplicate or minor story is on topic) */
  excludeReason?: ExcludeReason | null;
  /** web: who last changed the team's shared decision and when (read-only, from the review worker) */
  sharedBy?: string;
  sharedAt?: string;
  updatedAt: string;
  changes: Array<{ at: string; field: string; from: unknown; to: unknown }>;
}

export const EXCLUDE_REASONS = ['off_topic', 'other_area', 'duplicate', 'minor'] as const;
export type ExcludeReason = (typeof EXCLUDE_REASONS)[number];
export const EXCLUDE_REASON_LABEL: Record<ExcludeReason, string> = { off_topic: 'Lạc đề', other_area: 'Ngoài địa bàn', duplicate: 'Trùng tin', minor: 'Không quan trọng' };

export interface AdapterHealth {
  status: 'ok' | 'degraded' | 'unknown';
  fetched: number;
  parseFailed: number;
  partial: number;
  dateUnknown: number;
  failRate: number;
  mainContainer: string | null;
  containerShare: number;
  containers: Record<string, number>;
  reasons: string[];
  baseline: { runs: number; failRate: number | null; mainContainer: string | null };
}

export interface SourceRunStats {
  adapter?: AdapterHealth;
  sourceId: string;
  sourceName: string;
  status: 'pending' | 'running' | 'ok' | 'partial' | 'failed' | 'skipped_disabled' | 'manual_only' | 'cancelled';
  routes: Array<{ method: DiscoveryMethod; url: string; status: 'ok' | 'error' | 'limit'; httpStatus?: number | null; found: number; error?: string }>;
  listingPagesVisited: number;
  listingPageLimit: number;
  limitReached: boolean;
  candidates: number;
  error?: string;
}

export interface RunManifest {
  runId: string;
  createdAt: string;
  finishedAt: string | null;
  window: { from: string; to: string };
  trigger: 'manual' | 'auto' | 'retry' | 'fixture';
  status: 'running' | 'completed' | 'cancelled' | 'failed' | 'interrupted';
  sources: SourceRunStats[];
  counts: Record<string, number>;
  completeness: 'complete_within_enumerated_scope' | 'incomplete' | 'unknown';
  settingsHash: string;
  notes: string[];
  /** profile (cấu hình) this run was collected with; absent on runs made before profiles existed = TP.HCM */
  profileId?: string;
}
