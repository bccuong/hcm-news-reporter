import { describe, expect, it } from 'vitest';
import { clusterArticles, type Clusterable } from '../src/domain/cluster.js';

/** Titles/sapos modelled on the live 15/11/2026 run (scripts/eval-clusters.ts). */
const a = (id: string, sourceId: string, title: string, sapo = '', publishedAt = '2026-11-14T12:00:00+07:00'): Clusterable => ({ id: `a_${id}`, sourceId, title, sapo, publishedAt, duplicateGroupId: null });

describe('same-event clustering', () => {
  it('joins one event reported with different titles by 4 publishers into ONE cluster (transitive)', () => {
    const list = [
      a('1', 'vne', 'Xe thiết giáp chìm khi huấn luyện, 6 quân nhân hy sinh', 'Xe thiết giáp chìm trong lúc huấn luyện vượt sông, 6 quân nhân hy sinh, Bộ Quốc phòng thông tin.'),
      a('2', 'bxd', 'Xe thiết giáp chìm khi huấn luyện, 6 quân nhân hy sinh', 'Xe thiết giáp chìm trong lúc huấn luyện vượt sông, 6 quân nhân hy sinh.'),
      a('3', 'tn', 'Bộ Quốc phòng thông tin về việc 6 quân nhân hy sinh khi thực hiện nhiệm vụ', 'Xe thiết giáp chìm khi huấn luyện vượt sông khiến 6 quân nhân hy sinh.'),
      a('4', 'sggp', 'Bộ Quốc phòng thông tin về việc quân nhân hy sinh khi thực hiện nhiệm vụ', 'Trong lúc huấn luyện vượt sông, xe thiết giáp bị chìm, 6 quân nhân hy sinh.'),
      a('5', 'tn', 'Tổng Bí thư, Chủ tịch nước dự Hội nghị cấp cao Pháp ngữ', 'Tổng Bí thư, Chủ tịch nước dự khai mạc hội nghị.'),
      a('6', 'sggp', 'Chủ tịch UBND TPHCM dự Ngày hội Đại đoàn kết tại xã Bình Châu', 'Chủ tịch UBND dự ngày hội đại đoàn kết toàn dân tộc.'),
    ];
    const g = clusterArticles(list);
    const big = [...g.values()].find((ids) => ids.includes('a_1'))!;
    expect(big.sort()).toEqual(['a_1', 'a_2', 'a_3', 'a_4']);
    expect(list[4]!.duplicateGroupId).toBeNull(); // unrelated political news not chained in
    expect(list[5]!.duplicateGroupId).toBeNull();
  });
  it('ignores generic one-word titles and far-apart dates', () => {
    const list = [
      a('1', 'vne', 'Quy hoạch', '', '2026-09-06T12:00:00+07:00'),
      a('2', 'vne', 'Quy hoạch', '', '2026-11-14T12:00:00+07:00'),
      a('3', 'tn', 'Hải Phòng dự kiến đấu giá 211 cơ sở nhà, đất công', '', '2026-11-14T11:42:00+07:00'),
      a('4', 'vne', 'Hải Phòng dự kiến đấu giá hơn 200 nhà, đất công', '', '2026-11-15T13:48:00+07:00'),
    ];
    clusterArticles(list);
    expect(list[0]!.duplicateGroupId).toBeNull();
    expect(list[2]!.duplicateGroupId).toBe(list[3]!.duplicateGroupId);
    expect(list[2]!.duplicateGroupId).not.toBeNull();
  });
  it('cluster ids are deterministic across re-runs', () => {
    const mk = () => [a('x9', 'tn', 'Hải Phòng dự kiến đấu giá 211 cơ sở nhà, đất công'), a('x1', 'vne', 'Hải Phòng dự kiến đấu giá hơn 200 nhà, đất công')];
    const l1 = mk();
    const l2 = mk().reverse();
    clusterArticles(l1);
    clusterArticles(l2);
    expect(l1[0]!.duplicateGroupId).toBe(l2[1]!.duplicateGroupId);
  });
});
