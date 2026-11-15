import { describe, expect, it } from 'vitest';
import { defaultSettings } from '../src/domain/defaults.js';
import { judgeRelevance } from '../src/domain/relevance.js';

/**
 * Regression sample from the live runs of 15/11 and 16/11/2026 (titles + leads, shortened).
 * Labels follow the Skill criteria (six sectors in HCMC). Relevant stories must NEVER be excluded.
 */
const s = defaultSettings();
const judge = (title: string, sapo: string, body = '') => judgeRelevance(title, `${sapo}\n${body}`, 'x', s, sapo);

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
    expect(judge(title, sapo).status).not.toBe('irrelevant');
  });
  it.each(IRRELEVANT)('excludes with an explicit reason: %s', (title, sapo, reason) => {
    const v = judge(title, sapo);
    expect(v.status).toBe('irrelevant');
    expect(v.reasonCode).toBe(reason);
  });
  it('HCM only mentioned once deep in the body → review, not ready', () => {
    const v = judge('Đẩy nhanh giải ngân vốn đầu tư công các dự án giao thông', 'Nhiều địa phương đẩy nhanh giải ngân vốn đầu tư công.', 'Trong đó TP.HCM cũng đặt mục tiêu cao.');
    expect(v.status).toBe('review');
    expect(v.reasonCode).toBe('HCM_ONLY_IN_BODY');
  });
  it('rules are operator-adjustable (UI settings), e.g. disabling the lead-sector rule', () => {
    const off = { ...s, rules: { ...s.rules, requireSectorInLead: false } };
    const v = judgeRelevance('Chó thả rông ở TP.HCM không có người nhận', 'Chó thả rông ở TP.HCM.', 'x', off, 'Chó thả rông ở TP.HCM.');
    expect(v.reasonCode).not.toBe('NO_SECTOR_IN_LEAD');
  });
});
