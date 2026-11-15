import { Ban, Plus, Trash2 } from 'lucide-react';
import { describeRule } from '../../src/domain/rules';
import type { RuleGroup, RuleNode, RuleTerm } from '../../src/domain/schemas';
import { uid } from '../../src/domain/text';

const newTerm = (): RuleTerm => ({ kind: 'term', id: uid('t'), field: 'any', match: 'word', value: '', negate: false });
const newGroup = (op: 'AND' | 'OR' = 'OR'): RuleGroup => ({ kind: 'group', id: uid('g'), op, negate: false, children: [newTerm()] });

function update(node: RuleNode, id: string, fn: (n: RuleNode) => RuleNode | null): RuleNode | null {
  if (node.id === id) return fn(node);
  if (node.kind === 'group') {
    const children = node.children.map((c) => update(c, id, fn)).filter((c): c is RuleNode => c !== null);
    return { ...node, children };
  }
  return node;
}

/** Visual nested AND/OR/NOT builder – no regex or JSON required. */
export function RuleBuilder({ root, onChange }: { root: RuleGroup; onChange: (r: RuleGroup) => void }) {
  const set = (id: string, fn: (n: RuleNode) => RuleNode | null) => {
    const r = update(root, id, fn);
    if (r && r.kind === 'group') onChange(r);
  };
  return (
    <div>
      <GroupView g={root} set={set} isRoot />
      <p className="mt-2 rounded bg-slate-50 p-2 text-xs text-slate-600">
        <b>Diễn giải:</b> {describeRule(root)}
      </p>
    </div>
  );
}

function GroupView({ g, set, isRoot }: { g: RuleGroup; set: (id: string, fn: (n: RuleNode) => RuleNode | null) => void; isRoot?: boolean }) {
  const border = g.negate ? 'border-red-300 bg-red-50/40' : g.op === 'AND' ? 'border-navy-100 bg-navy-50/40' : 'border-teal-100 bg-teal-50/40';
  return (
    <div className={`rounded-md border-l-4 border ${border} p-2`}>
      <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
        <button type="button" className={`btn-xs btn ${g.negate ? 'border-red-400 bg-red-600 text-white' : 'btn-ghost'}`} onClick={() => set(g.id, (n) => ({ ...(n as RuleGroup), negate: !g.negate }))} title="Đảo nhóm (KHÔNG)">
          <Ban className="h-3 w-3" /> KHÔNG
        </button>
        <div className="inline-flex overflow-hidden rounded border border-slate-300" role="radiogroup" aria-label="Toán tử nhóm">
          {(['AND', 'OR'] as const).map((op) => (
            <button key={op} type="button" role="radio" aria-checked={g.op === op} className={`px-2 py-1 ${g.op === op ? 'bg-navy-700 text-white' : 'bg-white'}`} onClick={() => set(g.id, (n) => ({ ...(n as RuleGroup), op }))}>
              {op === 'AND' ? 'TẤT CẢ (VÀ)' : 'BẤT KỲ (HOẶC)'}
            </button>
          ))}
        </div>
        <span className="text-slate-500">{g.children.length} điều kiện</span>
        <span className="flex-1" />
        <button type="button" className="btn-ghost btn-xs" onClick={() => set(g.id, (n) => ({ ...(n as RuleGroup), children: [...(n as RuleGroup).children, newTerm()] }))}>
          <Plus className="h-3 w-3" /> Từ khóa
        </button>
        <button type="button" className="btn-ghost btn-xs" onClick={() => set(g.id, (n) => ({ ...(n as RuleGroup), children: [...(n as RuleGroup).children, newGroup(g.op === 'AND' ? 'OR' : 'AND')] }))}>
          <Plus className="h-3 w-3" /> Nhóm con
        </button>
        {!isRoot && (
          <button type="button" className="btn-danger btn-xs" onClick={() => set(g.id, () => null)} aria-label="Xóa nhóm">
            <Trash2 className="h-3 w-3" />
          </button>
        )}
      </div>
      <div className="space-y-1.5">
        {g.children.map((c, i) => (
          <div key={c.id} className="flex items-start gap-1">
            <span className="mt-1.5 w-10 shrink-0 text-right text-[10px] font-bold text-slate-400">{i === 0 ? '' : g.op === 'AND' ? 'VÀ' : 'HOẶC'}</span>
            <div className="flex-1">{c.kind === 'group' ? <GroupView g={c} set={set} /> : <TermView t={c} set={set} />}</div>
          </div>
        ))}
        {g.children.length > 40 && <p className="text-xs text-slate-500">Nhóm có {g.children.length} điều kiện.</p>}
      </div>
    </div>
  );
}

function TermView({ t, set }: { t: RuleTerm; set: (id: string, fn: (n: RuleNode) => RuleNode | null) => void }) {
  const patch = (p: Partial<RuleTerm>) => set(t.id, (n) => ({ ...(n as RuleTerm), ...p }));
  return (
    <div className="flex flex-wrap items-center gap-1">
      <button type="button" className={`btn-xs btn ${t.negate ? 'border-red-400 bg-red-600 text-white' : 'btn-ghost'}`} onClick={() => patch({ negate: !t.negate })} aria-pressed={t.negate}>
        KHÔNG
      </button>
      <select className="input w-auto py-1 text-xs" value={t.field} onChange={(e) => patch({ field: e.target.value as RuleTerm['field'] })} aria-label="Vùng tìm">
        <option value="any">Tiêu đề hoặc nội dung</option>
        <option value="title">Chỉ tiêu đề</option>
        <option value="body">Chỉ nội dung</option>
      </select>
      <select className="input w-auto py-1 text-xs" value={t.match} onChange={(e) => patch({ match: e.target.value as RuleTerm['match'] })} aria-label="Kiểu khớp">
        <option value="word">Nguyên từ</option>
        <option value="phrase">Cụm chính xác</option>
        <option value="substring">Chứa chuỗi</option>
      </select>
      <input className={`input min-w-[8rem] flex-1 py-1 text-xs ${!t.value.trim() ? 'border-red-400' : ''}`} value={t.value} placeholder="từ khóa…" onChange={(e) => patch({ value: e.target.value })} aria-label="Từ khóa" />
      <button type="button" className="btn-danger btn-xs" onClick={() => set(t.id, () => null)} aria-label={`Xóa điều kiện ${t.value}`}>
        <Trash2 className="h-3 w-3" />
      </button>
    </div>
  );
}
