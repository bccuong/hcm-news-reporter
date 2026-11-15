import { z } from 'zod';

const clock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Giờ phải có dạng HH:mm');
const httpUrl = z
  .string()
  .trim()
  .url('URL không hợp lệ')
  .refine((u) => /^https?:\/\//i.test(u), 'Chỉ chấp nhận http(s)');

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
      followPagination: z.boolean().default(true),
    })
    .default({}),
  maxConcurrency: z.number().int().min(1).max(8).default(2),
  pauseMs: z.number().int().min(0).max(30000).default(200),
  articleUrlPattern: z.string().default(''),
  excludeUrlPattern: z.string().default(''),
  notes: z.string().default(''),
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
  name: z.string().min(1),
  root: RuleNodeSchema,
  /** Optional: only applies to these sources (per-source override). Empty = all */
  sourceIds: z.array(z.string()).default([]),
});
export type RulePreset = z.infer<typeof RulePresetSchema>;

export const CategoryCode = z.enum(['LAND', 'BUILD', 'INFRA', 'TRAFFIC', 'REALESTATE', 'FLOOD', 'INVEST', 'POLICY']);
export type CategoryCode = z.infer<typeof CategoryCode>;

export const CategorySchema = z.object({
  code: CategoryCode,
  label: z.string().min(1),
  enabled: z.boolean().default(true),
  priority: z.number().int().min(1).max(99),
  keywords: z.array(z.string()).default([]),
});
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
      defaultPreset: z.enum(['last_completed', 'today', 'yesterday', 'custom']).default('last_completed'),
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
      maxConcurrentRequests: z.number().int().min(1).max(16).default(5),
      maxRequestsPerHost: z.number().int().min(1).max(8).default(2),
      timeoutMs: z.number().int().min(2000).max(120000).default(15000),
      maxRetries: z.number().int().min(0).max(6).default(2),
      backoffBaseMs: z.number().int().min(100).max(30000).default(1000),
      userAgent: z.string().default('HCMNewsReporter/0.1 (local editorial tool)'),
      respectRobotsTxt: z.boolean().default(true),
    })
    .default({}),
  keywords: z
    .object({
      topicKeywords: z.array(z.string()).default([]),
      synonyms: z.array(z.object({ canonical: z.string().min(1), aliases: z.array(z.string()) })).default([]),
      excludePhrases: z.array(z.string()).default([]),
      excludeUrlSections: z.array(z.string()).default([]),
    })
    .default({}),
  rules: z
    .object({
      presets: z.array(RulePresetSchema).default([]),
      activePresetId: z.string().default(''),
      /** When no rule/keyword matches: send to review queue instead of excluding */
      unknownRelevancePolicy: z.enum(['review', 'exclude_with_reason']).default('review'),
      /** title or sapo must contain a sector keyword (tuned on the 15/11/2026 live sample) */
      requireSectorInLead: z.boolean().default(true),
    })
    .default({}),
  location: z
    .object({
      areas: z.array(LocationAreaSchema).default([]),
      otherProvinces: z.array(z.string()).default([]),
      requireHcmEvidence: z.boolean().default(true),
      connectedAreasForReview: z.boolean().default(true),
      /** no HCM area/alias/landmark at all → excluded with reason (visible in ledger) or review queue */
      noEvidencePolicy: z.enum(['review', 'exclude_with_reason']).default('exclude_with_reason'),
      /** HCM not in title/sapo: at least this many distinct HCM places in the body to be "ready" (else review) */
      minBodyAreasWithoutLead: z.number().int().min(1).max(10).default(2),
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
    })
    .default({}),
  report: z
    .object({
      organization: z.string().default('SỞ XÂY DỰNG THÀNH PHỐ HỒ CHÍ MINH – VĂN PHÒNG SỞ'),
      templateFile: z.string().default(''),
      outputFormats: z.array(z.enum(['pptx', 'pdf'])).default(['pptx']),
      filenamePattern: z.string().default('HCM_Diem_tin_{date}_{from}-{to}'),
      storiesPerPage: z.number().int().min(1).max(4).default(2),
      overflowPolicy: z.enum(['new_slide', 'warn_only']).default('new_slide'),
      pdfRenderer: z.enum(['auto', 'powerpoint', 'libreoffice', 'none']).default('auto'),
      libreOfficePath: z.string().default(''),
      powerPointPath: z.string().default(''),
      contactEmail: z.string().default(''),
    })
    .default({}),
  performance: z
    .object({
      httpCacheMinutes: z.number().int().min(0).max(1440).default(30),
      keepRunsDays: z.number().int().min(1).max(3650).default(90),
    })
    .default({}),
});
export type Settings = z.infer<typeof SettingsSchema>;

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
  updatedAt: string;
  changes: Array<{ at: string; field: string; from: unknown; to: unknown }>;
}

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
}
