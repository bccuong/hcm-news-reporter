/**
 * SYNTHETIC FIXTURE PUBLISHER – not real news. Every title is prefixed "[Mẫu thử]".
 * Known ground truth is exported so tests can verify 100% candidate accounting and section extraction.
 */
import type { Transport } from '../../src/collector/http.js';

export const A = 'https://fixture-a.example.vn';
export const B = 'https://fixture-b.example.vn';
export const C = 'https://fixture-c.example.vn';
/** Second working publisher reporting the SAME flood event as A (same-event merge tests). */
export const D = 'https://fixture-d.example.vn';
export const UD = { flood: `${D}/do-thi/mau-thu-mua-lon-toi-8-11-hiep-binh-ngap-sau-xe-chet-may-1851101101.htm` };
export const WINDOW = { from: '2026-11-08T17:00:00+07:00', to: '2026-11-09T08:00:00+07:00' };

const url = (slug: string, id: number) => `${A}/thoi-su/${slug}-${id}.htm`;
export const U = {
  flood: url('mau-thu-mua-lon-ngap-sau-phuong-hiep-binh', 1851101001),
  metro: url('mau-thu-khanh-thanh-nha-ga-metro-so-2', 1851101002),
  nodate: url('mau-thu-chung-cu-cu-xuong-cap-quan-4', 1851101003),
  hanoi: url('mau-thu-ha-noi-mo-rong-duong-vanh-dai', 1851101004),
  old: url('mau-thu-tin-cu-thang-truoc', 1851101005),
  late: url('mau-thu-thu-hoi-dat-du-an-vanh-dai-3-phuong-tam-binh', 1851101006),
  blocked: url('mau-thu-bai-bi-chan-truy-cap', 1851101007),
  disagree: url('mau-thu-gia-dat-moi-tphcm-bang-gia', 1851101008),
  dupAlias: url('mau-thu-khanh-thanh-nha-ga-metro-so-2-ban-sao', 1851101009),
  boundary: url('mau-thu-dung-8-gio-sang-ket-thuc-khung', 1851101010),
  sport: `${A}/the-thao/mau-thu-bong-da-cuoi-tuan-1851101011.htm`,
};

function page(o: {
  title: string; sapo: string; pub?: string; mod?: string; visible?: string; canonical?: string; body: string; jsonLdBody?: string; next?: string; og?: string;
}) {
  const ld = o.pub || o.jsonLdBody
    ? `<script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@type': 'NewsArticle', headline: o.title, ...(o.pub ? { datePublished: o.pub } : {}), ...(o.mod ? { dateModified: o.mod } : {}), ...(o.jsonLdBody ? { articleBody: o.jsonLdBody } : {}) })}</script>`
    : '';
  return `<!doctype html><html lang="vi"><head><meta charset="utf-8"><title>${o.title}</title>
${o.canonical ? `<link rel="canonical" href="${o.canonical}">` : ''}
${o.pub ? `<meta property="article:published_time" content="${o.pub}">` : ''}
${o.mod ? `<meta property="article:modified_time" content="${o.mod}">` : ''}
<meta property="og:image" content="${o.og ?? `${A}/img/og-default.jpg`}">
${ld}${o.next ? `<link rel="next" href="${o.next}">` : ''}</head>
<body><nav><a href="/">Trang chủ</a><a href="/thoi-su.htm">Thời sự</a></nav>
<div class="main"><h1 class="detail-title">${o.title}</h1>${o.visible ? `<div class="detail-time">${o.visible}</div>` : ''}
<h2 class="detail-sapo">${o.sapo}</h2>
<div class="detail-content">${o.body}</div>
<div class="related"><a href="${A}/thoi-su/lien-quan-khong-lien-quan-1851100999.htm">Tin liên quan không được tính là nội dung</a></div>
</div><footer>© Fixture</footer></body></html>`;
}

const P = (n: number, topic: string) =>
  Array.from({ length: n }, (_, i) => `<p>Đoạn ${i + 1} về ${topic}: nội dung mẫu thử dùng để kiểm tra bóc tách đầy đủ, có số liệu ${i + 1}.250 tỷ đồng và mốc ngày ${i + 1}/11/2026 để đối chiếu.</p>`).join('\n');

export const GROUND_TRUTH = {
  flood: { paragraphs: 8, headings: 2, tables: 1, figures: 1 },
};

export function siteARoutes(): Record<string, { status: number; body: string; headers?: Record<string, string> }> {
  const rss = `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>Fixture A</title>
<item><title>[Mẫu thử] Mưa lớn ngập sâu</title><link>${U.flood}?utm_source=rss</link><pubDate>Sun, 08 Nov 2026 19:30:00 +0700</pubDate></item>
<item><title>[Mẫu thử] Khánh thành nhà ga</title><link>${U.metro}</link><pubDate>Sun, 08 Nov 2026 21:00:00 +0700</pubDate></item>
<item><title>[Mẫu thử] Tin cũ</title><link>${U.old}</link><pubDate>Thu, 08 Oct 2026 09:00:00 +0700</pubDate></item>
<item><title>[Mẫu thử] Bị chặn</title><link>${U.blocked}</link><pubDate>Sun, 08 Nov 2026 22:00:00 +0700</pubDate></item>
</channel></rss>`;
  const sitemap = `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:news="http://www.google.com/schemas/sitemap-news/0.9">
<url><loc>${U.metro}</loc><news:news><news:publication_date>2026-11-08T21:00:00+07:00</news:publication_date><news:title>[Mẫu thử] Khánh thành nhà ga</news:title></news:news></url>
<url><loc>${U.nodate}</loc></url>
<url><loc>${U.dupAlias}</loc></url>
</urlset>`;
  const section1 = `<html><body><nav><a href="/">Trang chủ</a></nav><div class="list">
<a href="${U.flood}">[Mẫu thử] Mưa lớn</a><a href="${U.hanoi}">[Mẫu thử] Hà Nội</a><a href="${U.disagree}">[Mẫu thử] Giá đất</a>
<a href="${U.boundary}">[Mẫu thử] 8 giờ</a><a href="${U.sport}">[Mẫu thử] Bóng đá</a>
<a href="/tag/ngap">tag</a><a href="/img/logo.png">logo</a></div>
<div class="pagination"><a class="next" href="/thoi-su/trang-2.htm">Trang sau</a></div></body></html>`;
  const section2 = `<html><body><div class="list"><a href="${U.late}">[Mẫu thử] Thu hồi đất</a></div></body></html>`;

  const routes: Record<string, { status: number; body: string; headers?: Record<string, string> }> = {
    [`${A}/rss/thoi-su.rss`]: { status: 200, body: rss },
    [`${A}/sitemap-news.xml`]: { status: 200, body: sitemap },
    [`${A}/thoi-su.htm`]: { status: 200, body: section1 },
    [`${A}/thoi-su/trang-2.htm`]: { status: 200, body: section2 },
    [U.flood]: {
      status: 200,
      body: page({
        title: '[Mẫu thử] Mưa lớn tối 8.11 khiến nhiều tuyến đường ở phường Hiệp Bình (TP.HCM) ngập sâu',
        sapo: 'Mưa lớn kéo dài khiến nhiều tuyến đường ngập sâu, xe cộ ùn ứ, người dân chật vật di chuyển.',
        pub: '2026-11-08T19:30:00+07:00',
        visible: '08/11/2026 19:30 GMT+7',
        body: `${P(3, 'diễn biến mưa')}<h2>Nhiều điểm ngập kéo dài</h2>${P(3, 'các điểm ngập')}
<figure class="image"><img src="/img/ngap-hiep-binh.jpg" width="1200" height="800" alt="Đường ngập"><figcaption>Tuyến đường ngập sâu tối 8.11. Ảnh: Phóng viên Mẫu Thử</figcaption></figure>
<h3>Lượng mưa đo được</h3>
<table><caption>Lượng mưa theo trạm</caption><tr><th>Trạm</th><th>Lượng mưa (mm)</th></tr><tr><td>Hiệp Bình</td><td>98,5</td></tr><tr><td>Tân Sơn Hòa</td><td>76,2</td></tr></table>
${P(2, 'giải pháp chống ngập')}`,
      }),
    },
    [U.metro]: {
      status: 200,
      body: page({
        title: '[Mẫu thử] Khánh thành nhà ga metro số 2 tại TP.HCM, đưa vào khai thác',
        sapo: 'Nhà ga đầu tiên của tuyến metro số 2 được khánh thành và đưa vào khai thác thử.',
        pub: '2026-11-08T21:00:00+07:00',
        mod: '2026-11-09T10:15:00+07:00',
        canonical: U.metro,
        body: P(6, 'tuyến metro số 2 Bến Thành – Tham Lương'),
      }),
    },
    [U.dupAlias]: {
      status: 200,
      body: page({ title: '[Mẫu thử] Khánh thành nhà ga metro số 2 tại TP.HCM, đưa vào khai thác', sapo: 'Bản sao.', pub: '2026-11-08T21:00:00+07:00', canonical: U.metro, body: P(6, 'metro') }),
    },
    [U.nodate]: {
      status: 200,
      body: page({ title: '[Mẫu thử] Chung cư cũ xuống cấp ở phường Vĩnh Hội cần di dời', sapo: 'Chung cư cũ xuống cấp nghiêm trọng, nhiều hộ dân vẫn sinh sống.', body: P(5, 'chung cư cũ') }),
    },
    [U.hanoi]: {
      status: 200,
      body: page({ title: '[Mẫu thử] Hà Nội mở rộng đường vành đai, giải phóng mặt bằng', sapo: 'Thành phố Hà Nội đẩy nhanh giải phóng mặt bằng dự án đường.', pub: '2026-11-08T20:00:00+07:00', body: P(5, 'dự án đường ở Hà Nội') }),
    },
    [U.old]: { status: 200, body: page({ title: '[Mẫu thử] Tin cũ', sapo: 'Cũ', pub: '2026-10-08T09:00:00+07:00', body: P(4, 'tin cũ') }) },
    [U.late]: {
      status: 200,
      body: page({
        title: '[Mẫu thử] Phường Tam Bình công khai dự thảo bồi thường, thu hồi đất dự án Vành đai 3',
        sapo: 'Phường Tam Bình (TP.HCM) lấy ý kiến người dân về dự thảo bồi thường.',
        pub: '2026-11-09T06:45:00+07:00',
        next: `${U.late.replace('.htm', '-p2.htm')}`,
        body: `${P(4, 'dự thảo bồi thường')}<p>(Còn tiếp)</p>`,
      }),
    },
    [U.blocked]: { status: 403, body: 'Forbidden' },
    [U.disagree]: {
      status: 200,
      body: page({
        title: '[Mẫu thử] TP.HCM công bố bảng giá đất mới, nhiều khu vực tăng mạnh',
        sapo: 'Bảng giá đất mới áp dụng từ tháng 1.',
        pub: '2026-11-09T07:10:00+07:00',
        body: P(3, 'bảng giá đất'),
        jsonLdBody: 'Đầy đủ '.repeat(400),
      }),
    },
    [U.boundary]: {
      status: 200,
      body: page({ title: '[Mẫu thử] Thông báo phân luồng giao thông cầu Thủ Thiêm', sapo: 'Đăng đúng 08:00 – thuộc kỳ sau.', pub: '2026-11-09T08:00:00+07:00', body: P(4, 'phân luồng giao thông TP.HCM') }),
    },
    [U.sport]: { status: 200, body: page({ title: '[Mẫu thử] Bóng đá', sapo: 'x', pub: '2026-11-08T20:00:00+07:00', body: P(3, 'bóng đá') }) },
    // Source B: everything fails (unreachable source must not block A)
    [`${B}/rss/home.rss`]: { status: 503, body: '' },
    // Source D: same event as U.flood, published later by another outlet
    [`${D}/rss/do-thi.rss`]: {
      status: 200,
      body: `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>Fixture D</title>
<item><title>[Mẫu thử] Mưa lớn tối 8.11, nhiều tuyến đường phường Hiệp Bình ngập sâu</title><link>${UD.flood}</link><pubDate>Sun, 08 Nov 2026 20:15:00 +0700</pubDate></item>
</channel></rss>`,
    },
    [UD.flood]: {
      status: 200,
      body: page({
        title: '[Mẫu thử] Mưa lớn tối 8.11, nhiều tuyến đường phường Hiệp Bình (TP.HCM) ngập sâu, xe chết máy',
        sapo: 'Cơn mưa lớn tối 8.11 khiến nhiều tuyến đường tại phường Hiệp Bình ngập sâu, nhiều xe chết máy.',
        pub: '2026-11-08T20:15:00+07:00',
        body: P(5, 'mưa ngập phường Hiệp Bình'),
        og: `${D}/img/ngap.jpg`,
      }),
    },
  };
  return routes;
}

export const EXPECTED = {
  /** canonical-unique candidates on source A within enumerated scope */
  uniqueCandidatesA: 11,
  states: {
    [U.flood]: 'ready_for_review',
    [U.metro]: 'ready_for_review',
    [U.dupAlias]: 'duplicate',
    [U.nodate]: 'date_unverified',
    [U.hanoi]: 'irrelevant_with_evidence',
    [U.old]: 'outside_window',
    [U.late]: 'parsed_partial',
    [U.blocked]: 'blocked',
    [U.disagree]: 'parsed_partial',
    [U.boundary]: 'outside_window',
    [U.sport]: 'irrelevant_with_evidence',
  } as Record<string, string>,
};

export function fixtureTransport(extra: Record<string, { status: number; body: string; headers?: Record<string, string> }> = {}, log: string[] = []): Transport {
  const routes = { ...siteARoutes(), ...extra };
  return async (u) => {
    log.push(u);
    if (u.startsWith(C)) throw new Error('DISABLED SOURCE MUST NOT BE FETCHED');
    const r = routes[u];
    if (!r) return { status: 404, headers: {}, body: '' };
    return { status: r.status, headers: r.headers ?? { 'content-type': 'text/html; charset=utf-8' }, body: r.body };
  };
}

export const publicResolver = async () => ['203.0.113.10'];
