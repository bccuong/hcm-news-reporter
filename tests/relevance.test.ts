import { describe, expect, it } from 'vitest';
import { defaultSettings } from '../src/domain/defaults.js';
import { annotateArticle, judgeRelevance } from '../src/domain/relevance.js';
import { SettingsSchema, type Article } from '../src/domain/schemas.js';

/**
 * Regression sample from the live runs of 15/11 and 16/11/2026 (titles + leads, shortened).
 * Labels follow the Skill criteria (six sectors in HCMC). Relevant stories must NEVER be excluded.
 */
const s = defaultSettings();
const judge = (title: string, sapo: string, body = '') => judgeRelevance(title, `${sapo}\n${body}`, 'x', s, sapo);


const fake = (title: string, sapo: string, body = ''): Article => ({
  id: 'a_t', runId: 'r', sourceId: 'x', sourceName: 'X', originType: 'website', originalUrl: 'https://x.vn/a.htm', canonicalUrl: null, title, sapo,
  bodyText: body, contentSections: [], articleLinks: [], author: null, publishedAt: null, modifiedAt: null, collectedAt: '', dateConfidence: 'verified',
  dateEvidence: [], extractionAdapterVersion: 't', extractionCompleteness: 'auto_checks_passed', extractionWarnings: [], continuation: { detected: false, urls: [] },
  location: { status: 'unknown', evidence: [] }, relevance: { status: 'review', score: 0, evidence: [] }, primaryCategory: null, secondaryCategories: [],
  classificationEvidence: [], suggestedAssessment: null, assessmentEvidence: [], imageCandidates: [], duplicateGroupId: null, warnings: [],
});
const annotate = (title: string, sapo: string, body = '') => annotateArticle(fake(title, sapo, body), s);


const RELEVANT: Array<[string, string]> = [
  ['Vụ nổ sập nhà ở TP.HCM: Phong tỏa đường Bùi Văn Ba, di dời bình gas', 'Liên quan vụ nổ sập nhà ở TP.HCM trên đường Bùi Văn Ba (phường Tân Thuận), lực lượng chức năng vẫn đang phong tỏa hiện trường.'],
  ['Bồi thường đất giấy tay thế nào cho công bằng?', 'Đánh giá cao đề xuất hỗ trợ, bồi thường nhà đất giao dịch bằng giấy tay khi nhà nước thu hồi đất.'],
  ['Gần 30 km Vành đai 3 TP HCM trước thời điểm thông xe', 'Khoảng 28 km đường Vành đai 3 qua Đồng Nai, TP HCM đã hoàn thiện căn bản, nhà thầu đang tăng tốc thi công.'],
  ['Gỡ nút thắt đơn giá nhân công để công trường tăng tốc', 'Yêu cầu đẩy nhanh tiến độ thi công và giải ngân tại hàng loạt dự án hạ tầng giao thông đang kéo theo nhu cầu lớn về lao động.'],
  ['Dự án chống ngập hơn 10.000 tỷ đồng: Dự kiến ngày 30-11 vận hành 6 cống ngăn triều', 'Sáu cống ngăn triều của Dự án chống ngập hơn 10.000 tỷ đồng dự kiến vận hành chính thức vào cuối tháng 11.'],
  ['Mưa lớn gây ngập đường ở TP.HCM sáng cuối tuần, hàng quán ế ẩm, khách Tây chật vật', 'Cơn mưa lớn sáng cuối tuần khiến nhiều tuyến đường ở TP.HCM ngập nước.'],
  ['TP.HCM mưa lớn từ sáng sớm cuối tuần, người dân tranh thủ dạo phố ngày mát mẻ', 'Những cơn mưa giữa tháng 11 khiến TP.HCM dịu mát.'],
];
const IRRELEVANT: Array<[string, string, string]> = [
  ['Giải Pickleball ngành Xây dựng 2026: Từ sân đấu pickleball đến sự gắn kết toàn ngành', 'Giải Pickleball ngành Xây dựng 2026 khép lại với 5 nội dung vô địch.', 'EXCLUDED_PHRASE'],
  ['Chó thả rông ở TP.HCM không có người nhận, xử lý thế nào?', 'Nhiều loại chó thả rông ở TP.HCM bị lực lượng chức năng địa phương bắt giữ.', 'NO_SECTOR_IN_LEAD'],
  ['Ông Zelensky: Mỹ nêu ý tưởng Ukraine từ bỏ Donbass để gia nhập NATO', 'Tổng thống Zelensky cho biết các nhà đàm phán Mỹ đã đề cập khả năng Ukraine rút khỏi khu vực Donbass.', 'NO_SECTOR_IN_LEAD'],
  ['Rào chắn lũ khổng lồ khiến Venice đối mặt đại dịch chuột', 'Công trình rào chắn lũ giúp Venice thoát cảnh ngập lụt mỗi khi triều cường dâng cao.', 'NO_HCM_EVIDENCE'],
  ['Chủ tịch UBND TPHCM Lê Quốc Phong dự Ngày hội Đại đoàn kết toàn dân tộc tại ấp Bình Minh', 'Chiều 14-11, Chủ tịch UBND TPHCM đã đến dự Ngày hội Đại đoàn kết toàn dân tộc.', 'NO_SECTOR_IN_LEAD'],
  ['Giá vàng hôm nay 15.11.2026: Giảm mạnh khiến người mua lỗ 7 triệu sau một tuần', 'Giá vàng trong nước và thế giới đều giảm mạnh.', 'EXCLUDED_PHRASE'],
  ['TP.HCM: Giáo viên THPT nào đủ tiêu chuẩn xét thăng hạng lên hạng II và I?', 'Sở GD-ĐT TP.HCM hướng dẫn xét thăng hạng giáo viên.', 'NO_SECTOR_IN_LEAD'],
];

describe('relevance regression (live sample 15–16/11/2026)', () => {
  it.each(RELEVANT)('never excludes a relevant story: %s', (title, sapo) => {
    // since 17/11/2026 a story with no place of the city at all (title, sapo AND body) is kept only when it is a
    // sector-wide policy / law; these samples have no body here, the real articles name the city in it
    const v = judge(title, sapo);
    if (v.reasonCode === 'NO_HCM_EVIDENCE') {
      expect(judge(title, sapo, 'Công trình thuộc địa bàn TP.HCM.').status).not.toBe('irrelevant');
      const old = structuredClone(s);
      old.location.noPlaceKeep = 'strong_sector';
      expect(judgeRelevance(title, sapo, 'x', old, sapo).status).not.toBe('irrelevant');
    } else expect(v.status).not.toBe('irrelevant');
  });
  it.each(IRRELEVANT)('excludes with an explicit reason: %s', (title, sapo, reason) => {
    const v = judge(title, sapo);
    expect(v.status).toBe('irrelevant');
    expect(v.reasonCode).toBe(reason);
  });
  it('HCM only mentioned once deep in the body → review, not ready (sector in the title → ready, 18/11/2026)', () => {
    const off = structuredClone(s);
    off.location.nationalToReady = false;
    const v = judgeRelevance('Đẩy nhanh giải ngân vốn đầu tư công các dự án giao thông', 'Nhiều địa phương đẩy nhanh giải ngân vốn đầu tư công.\nTrong đó TP.HCM cũng đặt mục tiêu cao.', 'x', off, 'Nhiều địa phương đẩy nhanh giải ngân vốn đầu tư công.');
    expect(v.status).toBe('review');
    expect(v.reasonCode).toBe('HCM_ONLY_IN_BODY');
    expect(judge('Đẩy nhanh giải ngân vốn đầu tư công các dự án giao thông', 'Nhiều địa phương đẩy nhanh giải ngân vốn đầu tư công.', 'Trong đó TP.HCM cũng đặt mục tiêu cao.').status).toBe('relevant');
  });
  it('rules are operator-adjustable (UI settings), e.g. disabling the lead-sector rule', () => {
    const off = { ...s, rules: { ...s.rules, requireSectorInLead: false } };
    const v = judgeRelevance('Chó thả rông ở TP.HCM không có người nhận', 'Chó thả rông ở TP.HCM.', 'x', off, 'Chó thả rông ở TP.HCM.');
    expect(v.reasonCode).not.toBe('NO_SECTOR_IN_LEAD');
  });
});

describe('"Chính sách, pháp quy" must be about construction or transport (user feedback 16/11/2026)', () => {
  const POLICY_OFF_TOPIC: Array<[string, string, string?]> = [
    ['TP.HCM quy định mới về trường tiên tiến, trường chất lượng cao', 'UBND TP.HCM quy định về nội dung bắt buộc và đặc thù trong chương trình giáo dục của trường tiên tiến, trường chất lượng cao… Đồng thời yêu cầu các trường về chuẩn đầu ra, điều kiện tổ chức cũng như mức thu ràng buộc.', 'Quyết định có hiệu lực từ ngày ký, căn cứ Luật Giáo dục và thay thế dự thảo trước đó.'],
    ['Kiểm soát quyền lực, thúc đẩy phát triển', 'Trong bối cảnh đất nước cần tăng tốc phát triển, việc kiểm soát chặt chẽ quyền lực phải đi đôi với tạo điều kiện để bộ máy chủ động quyết định, hành động kịp thời. Vì vậy, việc đổi mới công tác thanh tra góp phần đáp ứng đồng thời hai yêu cầu ấy.'],
    ['TP.HCM ban hành nghị quyết hỗ trợ học phí năm học mới', 'HĐND TP.HCM thông qua nghị quyết hỗ trợ học phí cho học sinh các cấp.'],
  ];
  it.each(POLICY_OFF_TOPIC)('a decree/law story outside the sectors is not "Chính sách, pháp quy" and is not ready: %s', (title, sapo, body) => {
    const a = annotate(title, sapo, body);
    expect(a.primaryCategory).not.toBe('POLICY');
    expect(a.relevance.status).not.toBe('relevant');
    expect(a.classificationEvidence.join(' ')).toContain('Chính sách, pháp quy: không tính');
  });
  it('a construction/transport decree keeps "Chính sách, pháp quy"', () => {
    const a = annotate('Dự thảo nghị định mới về cải tạo chung cư cũ tại TP.HCM', 'Bộ Xây dựng lấy ý kiến dự thảo nghị định về cải tạo, xây dựng lại chung cư cũ, áp dụng cho TP.HCM.');
    expect(a.classificationEvidence.some((e) => /^Chính sách, pháp quy: .*điểm/.test(e))).toBe(true);
    const t = annotate('TP.HCM ban hành quyết định phân luồng giao thông quanh nhà ga metro', 'UBND TP.HCM ban hành quyết định phân luồng giao thông tại các tuyến đường quanh nhà ga metro số 2.');
    expect(t.classificationEvidence.some((e) => /^Chính sách, pháp quy: .*điểm/.test(e))).toBe(true);
  });
  it('"yêu cầu", "nhu cầu", "toàn cầu" are not bridges (Giao thông)', () => {
    const a = annotate('TP.HCM yêu cầu đáp ứng nhu cầu học tập', 'Sở yêu cầu các trường đáp ứng nhu cầu toàn cầu hóa.');
    expect(a.classificationEvidence.join(' ')).not.toContain('Giao thông');
    expect(annotate('Thông xe cầu Thủ Thiêm 4 tại TP.HCM', 'Cầu Thủ Thiêm 4 nối TP.HCM với khu đô thị mới.').classificationEvidence.join(' ')).toContain('Giao thông: cầu');
  });
  it('the requirement and excluded phrases are user settings (and old saved configs receive the defaults)', () => {
    const old = SettingsSchema.parse({ ...JSON.parse(JSON.stringify(s)), categories: s.categories.map(({ requiresCategories: _r, excludePhrases: _e, ...c }) => c) });
    expect(old.categories.find((c) => c.code === 'POLICY')!.requiresCategories).toContain('BUILD');
    expect(old.categories.find((c) => c.code === 'TRAFFIC')!.excludePhrases).toContain('yêu cầu');
    const off = structuredClone(s);
    off.categories.find((c) => c.code === 'POLICY')!.requiresCategories = [];
    const a = annotateArticle(fake('TP.HCM quy định mới về trường tiên tiến, trường chất lượng cao', 'UBND TP.HCM quy định về chương trình giáo dục.', 'Quyết định có hiệu lực từ ngày ký.'), off);
    expect(a.classificationEvidence.some((e) => /^Chính sách, pháp quy: .*điểm/.test(e))).toBe(true);
  });
});

describe('safety net: strong sector evidence only in the body → review, never silently excluded', () => {
  it('road-network plan whose title/sapo name no sector keyword', () => {
    const custom = structuredClone(s);
    custom.categories.find((c) => c.code === 'TRAFFIC')!.keywords = custom.categories.find((c) => c.code === 'TRAFFIC')!.keywords.filter((k) => k !== 'đường bộ'); // like a saved config without it
    const title = '5 điều chỉnh đáng chú ý trong mạng đường bộ TPHCM tầm nhìn 100 năm';
    const sapo = 'Với quy hoạch 100 năm, TPHCM được định hướng thành trung tâm kinh tế của châu Á, hướng tới đô thị toàn cầu.';
    const body = 'Bổ sung tuyến vành đai 4.5, kéo dài cao tốc Biên Hòa - Vũng Tàu, thêm nút giao và tuyến đường sắt đô thị; giao thông kết nối cảng Cát Lái, Hiệp Phước.';
    const v = judgeRelevance(title, `${sapo}\n${body}`, 'x', custom, sapo);
    expect(v.status).toBe('review');
    expect(v.reasonCode).toBe('SECTOR_ONLY_IN_BODY');
    custom.rules.bodySectorScoreForReview = 0; // user can switch the net off
    expect(judgeRelevance(title, `${sapo}\n${body}`, 'x', custom, sapo).reasonCode).toBe('NO_SECTOR_IN_LEAD');
    // with the new default keyword "đường bộ" the title alone names the sector
    expect(judgeRelevance(title, `${sapo}\n${body}`, 'x', s, sapo).status).not.toBe('irrelevant');
  });
});

describe('saved keyword lists receive new default keywords once (user approved 16/11/2026)', () => {
  it('an old saved list gets "đường bộ"…; a later removal by the user is kept', () => {
    const raw = JSON.parse(JSON.stringify(s));
    const tr = raw.categories.find((c: { code: string }) => c.code === 'TRAFFIC');
    tr.keywords = ['giao thông', 'cầu', 'Đường bộ'];
    delete tr.keywordsRev;
    const up = SettingsSchema.parse(raw).categories.find((c) => c.code === 'TRAFFIC')!;
    expect(up.keywords).toEqual(['giao thông', 'cầu', 'Đường bộ', 'đường thủy', 'sân bay', 'bến xe', 'cảng biển', 'CSGT', 'vi phạm giao thông', 'tai nạn giao thông', 'phạt nguội', 'an toàn giao thông', 'đèn đỏ', 'Nghị định 168', 'xe máy', 'vận tải', 'giá cước']); // no duplicate; rev 2, 3, 4 then 5
    expect(up.keywordsRev).toBe(5);
    const saved = JSON.parse(JSON.stringify({ ...raw, categories: raw.categories.map((c: { code: string }) => (c.code === 'TRAFFIC' ? { ...up, keywords: up.keywords.filter((k) => k !== 'sân bay') } : c)) }));
    expect(SettingsSchema.parse(saved).categories.find((c) => c.code === 'TRAFFIC')!.keywords).not.toContain('sân bay');
  });
});

describe('defaults requested by the user (16/11/2026)', () => {
  it('the window preset when the app opens is "Hôm nay"', () => {
    expect(s.reportWindow.defaultPreset).toBe('today');
  });
});

describe('off-region / off-topic stories seen in the review queue (user feedback 16/11/2026)', () => {
  const ex = (title: string, sapo: string, body = '') => judgeRelevance(title, `${sapo}\n${body}`, 'x', s, sapo);
  it.each([
    ['Miền Bắc sắp rét dưới 10 độ C, miền Trung mưa lớn 3 ngày', 'Dự báo thời tiết từ ngày 18.11, không khí lạnh bắt đầu ảnh hưởng đến nước ta.', 'Thời tiết Hà Nội chuyển rét. TP.HCM cuối thế kỷ 21 có thể nóng thêm.', 'NOT_GEOGRAPHICALLY_RELEVANT'],
    ['Hà Nội quy định thế nào là người có tài năng?', 'Người có tài năng được hưởng chính sách ưu đãi.', 'Ví dụ người đạt giải thưởng Hồ Chí Minh, giải thưởng nhà nước.', 'NOT_GEOGRAPHICALLY_RELEVANT'],
    ['Cầu Trần Hưng Đạo sau hơn một năm thi công', 'Hà NộiCầu Trần Hưng Đạo dần lộ rõ hình hài với nhiều trụ cầu chính đã hoàn thành.', '', 'NOT_GEOGRAPHICALLY_RELEVANT'],
    ['Quảng Trị chi hơn 370 tỉ đồng chỉnh trang nhiều nghĩa trang liệt sĩ', 'Tỉnh Quảng Trị đầu tư chỉnh trang nghĩa trang.', 'Con đường Trường Sơn - đường Hồ Chí Minh và sự hy sinh của các thế hệ.', 'NOT_GEOGRAPHICALLY_RELEVANT'],
    ['Ai sẽ trấn giữ khung thành đội tuyển Việt Nam trước Kyrgyzstan khi Lê Giang Patrik vắng mặt?', 'Việc 4 cầu thủ CLB Công an TP.HCM rời đội tuyển Việt Nam khiến HLV phải điều chỉnh.', '', 'EXCLUDED_PHRASE'],
    ['Giá heo hơi hôm nay 16.11.2026: Nhiều địa phương chạm mốc 52.000 đồng/kg', 'Tây Ninh, TP. HCM và Vĩnh Long cùng 51.000 đồng/kg.', '', 'EXCLUDED_PHRASE'],
    ['Microsoft bị khách hàng yêu cầu bồi thường sau sự cố toàn cầu', 'Khách hàng doanh nghiệp có thể được giảm 50% phí Microsoft 365 nếu đáp ứng điều kiện bồi hoàn.', '', 'NO_HCM_EVIDENCE'],
    ['PGS Nguyễn Viết Nhung: Việt Nam cần xây dựng thế hệ không thuốc lá', 'Nguyên giám đốc Bệnh viện Phổi Trung ương cho rằng cần quyết liệt hơn.', '', 'NO_HCM_EVIDENCE'],
  ])('excluded with a reason: %s', (title, sapo, body, reason) => {
    const v = ex(title, sapo, body);
    expect(v.status).toBe('irrelevant');
    expect(v.reasonCode).toBe(reason);
  });
  it('national news of the sector is kept for review even when held in Hà Nội', () => {
    const v = ex('Bộ trưởng Trần Hồng Minh kiểm tra công tác tổng duyệt sự kiện KHCN ngành Xây dựng 2026', 'Chiều 15/11, Bộ trưởng Bộ Xây dựng Trần Hồng Minh đã kiểm tra công tác tổng duyệt tại Hà Nội.');
    expect(v.status).toBe('review');
  });
  it('place look-alikes and other areas are user settings', () => {
    expect(s.location.excludePhrases).toContain('giải thưởng Hồ Chí Minh');
    expect(s.location.otherProvinces).toContain('miền Bắc');
    expect(s.keywords.excludePhrases).toContain('đội tuyển');
    const off = structuredClone(s);
    off.location.otherProvinces = off.location.otherProvinces.filter((p) => !/^miền /i.test(p));
    expect(judgeRelevance('Miền Bắc sắp rét dưới 10 độ C', 'Không khí lạnh.', 'x', off, 'Không khí lạnh.').reasonCode).not.toBe('NOT_GEOGRAPHICALLY_RELEVANT');
  });
});

describe('a story must be placed in the city, except sector-wide policy / law (user feedback 17/11/2026)', () => {
  const ex = (title: string, sapo: string, body = '') => judgeRelevance(title, `${sapo}\n${body}`, 'x', s, sapo);
  it.each([
    // a ward of the same name in another province ("phường Xuân Hòa (tỉnh Phú Thọ)")
    ['Phú Thọ: Khởi công khu nghỉ dưỡng InterContinental Thanh Xuan Valley Resort', 'Sáng 17/11, tại phường Xuân Hòa (tỉnh Phú Thọ), công ty khởi công dự án khu nghỉ dưỡng.', '', 'NOT_GEOGRAPHICALLY_RELEVANT'],
    // national sector news ABOUT another province
    ['Bộ Xây dựng giao Hà Tĩnh quản lý 51km cao tốc kết nối Cửa khẩu quốc tế Cầu Treo', 'Bộ Xây dựng vừa có quyết định giao UBND tỉnh Hà Tĩnh quản lý tuyến cao tốc.', '', 'NOT_GEOGRAPHICALLY_RELEVANT'],
    // no place of the city at all, not a policy
    ['Tai nạn giao thông 17/11: Va chạm ô tô tại ngã tư, nam thanh niên 18 tuổi tử vong', 'Va chạm giữa ô tô và xe máy tại ngã tư khiến một nam thanh niên tử vong.', '', 'NO_HCM_EVIDENCE'],
    // a connected area only deep in the body of a Hà Nội railway story
    ['Đề xuất giữ 260ha Tổ hợp ga Ngọc Hồi, tính phương án mở rộng trong 100 năm', 'Hồ sơ quy hoạch đề xuất giữ quỹ đất cho tổ hợp ga đường sắt.', 'Đường sắt tốc độ cao vượt đường Vành đai 4, hồ sơ đề xuất cao độ.', 'NO_HCM_EVIDENCE'],
  ])('excluded: %s', (title, sapo, body, reason) => {
    const v = ex(title, sapo, body);
    expect(v.status).toBe('irrelevant');
    expect(v.reasonCode).toBe(reason);
  });
  it.each([
    ['Khẩn trương tiếp thu, giải trình các dự án luật về nhà ở, kinh doanh bất động sản, đất đai', 'Phó Thủ tướng yêu cầu các bộ hoàn thiện hồ sơ.'],
    ['Phó Thủ tướng yêu cầu báo cáo về quy định bán lại nhà ở xã hội sau 5 năm', 'Bộ Xây dựng được giao rà soát.'],
    ['Bộ trưởng Trần Hồng Minh kiểm tra công tác tổng duyệt sự kiện KHCN ngành Xây dựng 2026', 'Chiều 15/11, tại Hà Nội, Bộ trưởng Bộ Xây dựng đã kiểm tra công tác tổng duyệt.'],
  ])('a general policy / law / national sector story is kept without a place: %s', (title, sapo) => {
    expect(ex(title, sapo).status).not.toBe('irrelevant');
  });
  it('the old rule (strong sector words are enough) is a setting', () => {
    const old = structuredClone(s);
    old.location.noPlaceKeep = 'strong_sector';
    old.location.noPlaceMinLeadScore = 3;
    expect(judgeRelevance('Tai nạn giao thông 17/11: Va chạm ô tô tại ngã tư', 'Va chạm giữa ô tô và xe máy, tai nạn giao thông.', 'x', old, 'Va chạm giữa ô tô và xe máy, tai nạn giao thông.').status).toBe('review');
  });
  it('a city ward in the lead still counts when no other province is named', () => {
    expect(ex('Khởi công trường học mới', 'Sáng 17/11, tại phường Xuân Hòa, UBND phường khởi công công trình trường học.').location.status).not.toBe('other_province');
  });
});

describe('a city master plan is construction news (Hỏi nhanh found it excluded, 17/11/2026)', () => {
  it('"Quy hoạch tổng thể TP.HCM" goes to the review lists, "quy hoạch cán bộ" does not', () => {
    const plan = judgeRelevance('TP.HCM công bố hồ sơ quy hoạch tổng thể tầm nhìn 100 năm', 'Sở Quy hoạch - Kiến trúc TP.HCM đã công bố hồ sơ Quy hoạch tổng thể TP.HCM thời kỳ 2025 - 2050.', 'x', s, 'Sở Quy hoạch - Kiến trúc TP.HCM đã công bố hồ sơ Quy hoạch tổng thể TP.HCM thời kỳ 2025 - 2050.');
    expect(plan.status).not.toBe('irrelevant');
    const staff = judgeRelevance('TP.HCM triển khai công tác quy hoạch cán bộ nhiệm kỳ mới', 'Thành ủy TP.HCM họp về công tác cán bộ.', 'x', s, 'Thành ủy TP.HCM họp về công tác cán bộ.');
    expect(staff.status).toBe('irrelevant');
  });
});

describe('stories the team moved by hand on 18/11/2026', () => {
  const ex = (title: string, sapo: string, body = '') => judgeRelevance(title, `${sapo}\n${body}`, 'x', s, sapo);
  it('a national policy / sector story with the sector in its TITLE goes straight to "Bài sẵn sàng"', () => {
    expect(ex('C08 nghiên cứu sửa Nghị định 168, chỉ cảnh cáo trường hợp vượt đèn đỏ lần đầu', 'Cục CSGT đề xuất sửa quy định xử phạt.').status).toBe('relevant');
    expect(ex('Bộ Xây dựng lập đoàn công tác kiểm tra giá cước vận tải khi giá nhiên liệu giảm', 'Bộ Xây dựng thành lập đoàn kiểm tra.').status).toBe('relevant');
    expect(ex('Áp trần giá chuyển nhượng nhà ở xã hội?', 'Dự thảo nghị định đề xuất áp trần giá.', 'Một doanh nghiệp làm nhà ở xã hội tại TP.HCM cho biết.').status).toBe('relevant');
  });
  it('…but the ministry name alone is not a sector ("Tuổi trẻ Bộ Xây dựng giành giải Ba") and foreign / stock / crime titles stay for review', () => {
    expect(ex('Tuổi trẻ Bộ Xây dựng giành giải Ba tại Tuần lễ Tài năng Sinh viên Chính phủ 2026', 'Đoàn Bộ Xây dựng giành giải Ba.').status).toBe('review');
    expect(ex('Các quỹ lớn gom cổ phiếu bất động sản sau nhịp giảm sâu', 'Khối ngoại mua ròng.', 'Nhà đầu tư tại TP.HCM.').status).toBe('review');
    expect(ex('Bất động sản Trung Quốc: Đà giảm giá nhà chậm lại', 'Giá nhà mới giảm chậm lại, chính sách hỗ trợ.').status).not.toBe('relevant');
  });
  it('the title names another province, the city is only in the sapo (a comparison) → not ready', () => {
    const v = ex('Những công trình kiến trúc Pháp trăm năm ở Huế tuyệt đẹp, hiếm nơi nào có', 'Dù quy mô không đồ sộ như tại Hà Nội, TP.HCM hay Đà Lạt, hệ thống các công trình kiến trúc Pháp ở Huế vẫn tạo nên diện mạo đặc trưng.');
    expect(v.status).toBe('review');
    expect(v.location.status).toBe('other_province');
  });
  it('Báo Xây dựng\'s daily digest "Tin mới nhất, hay nhất…" is excluded like "Điểm tin"', () => {
    expect(ex('Tin mới nhất, hay nhất trên Báo Xây dựng ngày 18/11/2026', 'Cấp, thoát nước tại Hà Nội và TP.HCM.').reasonCode).toBe('EXCLUDED_PHRASE');
  });
  it('"sập bẫy" is not a collapse', () => {
    expect(ex('Cựu nhân viên phòng gym tiết lộ chiêu bán thẻ tập khiến khách hàng sập bẫy', 'Khách hàng ở TP.HCM bị dụ ký hợp đồng.').status).not.toBe('relevant');
  });
});
