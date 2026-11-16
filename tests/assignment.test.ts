import { describe, expect, it } from 'vitest';
import { suggestAssignment } from '../src/domain/assignment.js';
import { defaultSettings } from '../src/domain/defaults.js';

/** Sở Xây dựng TP.HCM guidance (16/11/2026) – "Tồn tại cần khắc phục" → unit to advise / handle */
const s = defaultSettings();
const unit = (title: string, sapo = '') => suggestAssignment({ title, sapo }, s);

describe('suggested unit for "Tồn tại cần khắc phục"', () => {
  it.each([
    ['Mưa lớn gây ngập đường ở TP.HCM sáng cuối tuần', 'Phòng Hạ tầng kỹ thuật, Trung tâm Quản lý giao thông và Hạ tầng kỹ thuật tham mưu, xử lý'],
    ['Cây xanh gãy đổ đè người đi đường ở phường Bến Thành', 'Phòng Hạ tầng kỹ thuật, Trung tâm Quản lý giao thông và Hạ tầng kỹ thuật tham mưu, xử lý'],
    ['Kẹt xe kéo dài ở cửa ngõ phía đông TP.HCM', 'Trung tâm Quản lý điều hành giao thông đô thị tham mưu, xử lý'],
    ['Chủ đầu tư huy động vốn sai quy định, bán nhà ở hình thành trong tương lai khi chưa đủ điều kiện', 'Phòng Phát triển đô thị tham mưu, xử lý'],
    ['Chung cư xuống cấp nghiêm trọng, người dân lo sập', 'Phòng Quản lý chất lượng công trình tham mưu, xử lý'],
    ['Phát hiện công trình xây dựng không phép giữa khu dân cư', 'Phòng Kiểm tra chuyên ngành tham mưu, xử lý'],
    ['Đường Nguyễn Văn Linh chi chít ổ gà sau mưa', 'Phòng Bảo trì và Khai thác công trình giao thông tham mưu, xử lý'],
  ])('%s', (title, expected) => {
    expect(unit(title).text).toBe(`Đề xuất: giao ${expected}.`);
  });
  it('the title outweighs the sapo; no match → the general sentence', () => {
    // "ổ gà" in the title (3) beats "ngập" only in the sapo (1)
    expect(unit('Mặt đường đầy ổ gà sau mưa', 'Nhiều đoạn còn ngập nước.').rule).toBe('Hư hỏng mặt đường, ổ gà');
    expect(unit('Người dân phản ánh tiếng ồn ban đêm').text).toBe('Đề xuất: giao các phòng, đơn vị tham mưu theo chức năng, nhiệm vụ.');
  });
  it('rules are settings (Cài đặt › Báo cáo & mẫu)', () => {
    const c = structuredClone(s);
    c.editorial.assignmentRules = [{ name: 'Thử', keywords: ['tiếng ồn'], unit: 'Phòng Thử nghiệm tham mưu, xử lý' }];
    expect(suggestAssignment({ title: 'Người dân phản ánh tiếng ồn ban đêm', sapo: '' }, c).text).toBe('Đề xuất: giao Phòng Thử nghiệm tham mưu, xử lý.');
  });
});
