import type { RuleNode, Settings } from './schemas.js';
import { findSubstring, findWord, snippet } from './text.js';

export interface MatchTarget {
  title: string;
  body: string;
}

export interface RuleExplanation {
  matched: boolean;
  /** Human readable (Vietnamese) trace lines */
  lines: string[];
  /** Terms that positively matched, with snippets */
  hits: Array<{ term: string; via: string; field: string; snippet: string }>;
}

/** Expand a term with synonym groups (canonical <-> aliases are interchangeable). */
export function expandSynonyms(value: string, synonyms: Settings['keywords']['synonyms']): string[] {
  const v = value.trim().toLowerCase();
  for (const g of synonyms) {
    const all = [g.canonical, ...g.aliases];
    if (all.some((x) => x.trim().toLowerCase() === v)) return Array.from(new Set(all.map((x) => x.trim()).filter(Boolean)));
  }
  return [value];
}

function fieldText(t: MatchTarget, field: 'any' | 'title' | 'body'): Array<[string, string]> {
  if (field === 'title') return [['tiêu đề', t.title]];
  if (field === 'body') return [['nội dung', t.body]];
  return [
    ['tiêu đề', t.title],
    ['nội dung', t.body],
  ];
}

const FIELD_LABEL = { any: 'bất kỳ', title: 'tiêu đề', body: 'nội dung' } as const;

export function describeRule(node: RuleNode): string {
  if (node.kind === 'term') {
    const base = `${node.match === 'substring' ? 'chứa chuỗi' : 'có từ'} "${node.value}" (${FIELD_LABEL[node.field]})`;
    return node.negate ? `KHÔNG ${base}` : base;
  }
  if (node.children.length === 0) return node.negate ? 'KHÔNG (nhóm rỗng)' : '(nhóm rỗng)';
  const inner = node.children.map(describeRule).join(node.op === 'AND' ? ' VÀ ' : ' HOẶC ');
  return `${node.negate ? 'KHÔNG ' : ''}(${inner})`;
}

export function evaluateRule(
  node: RuleNode,
  target: MatchTarget,
  synonyms: Settings['keywords']['synonyms'] = [],
  depth = 0,
): RuleExplanation {
  const indent = '  '.repeat(depth);
  if (node.kind === 'term') {
    const variants = expandSynonyms(node.value, synonyms);
    const hits: RuleExplanation['hits'] = [];
    for (const [fname, text] of fieldText(target, node.field)) {
      for (const v of variants) {
        const idx = node.match === 'substring' ? findSubstring(text, v) : findWord(text, v);
        if (idx >= 0) {
          hits.push({ term: node.value, via: v, field: fname, snippet: snippet(text, idx, v.length) });
          break;
        }
      }
    }
    const raw = hits.length > 0;
    const matched = node.negate ? !raw : raw;
    const via = hits.length ? ` – thấy "${hits[0]!.via}" trong ${hits[0]!.field}` : ' – không thấy';
    return {
      matched,
      lines: [`${indent}${matched ? '✔' : '✘'} ${describeRule(node)}${via}`],
      hits: node.negate ? [] : hits,
    };
  }
  const results = node.children.map((c) => evaluateRule(c, target, synonyms, depth + 1));
  let raw: boolean;
  if (results.length === 0) raw = true;
  else raw = node.op === 'AND' ? results.every((r) => r.matched) : results.some((r) => r.matched);
  const matched = node.negate ? !raw : raw;
  return {
    matched,
    lines: [
      `${indent}${matched ? '✔' : '✘'} ${node.negate ? 'KHÔNG ' : ''}Nhóm ${node.op === 'AND' ? 'TẤT CẢ (VÀ)' : 'BẤT KỲ (HOẶC)'}`,
      ...results.flatMap((r) => r.lines),
    ],
    hits: node.negate ? [] : results.flatMap((r) => r.hits),
  };
}

/** Validate a tree; returns Vietnamese error messages (empty = OK). */
export function validateRule(node: RuleNode, path = 'Gốc'): string[] {
  const errs: string[] = [];
  if (node.kind === 'term') {
    if (!node.value.trim()) errs.push(`${path}: từ khóa rỗng`);
    return errs;
  }
  if (node.children.length === 0) errs.push(`${path}: nhóm chưa có điều kiện`);
  node.children.forEach((c, i) => errs.push(...validateRule(c, `${path} › ${i + 1}`)));
  // simple conflict detection: same term both required and negated directly in an AND group
  if (node.op === 'AND') {
    const pos = new Set(node.children.filter((c) => c.kind === 'term' && !c.negate).map((c) => (c as { value: string }).value.toLowerCase()));
    for (const c of node.children) {
      if (c.kind === 'term' && c.negate && pos.has(c.value.toLowerCase())) {
        errs.push(`${path}: mâu thuẫn – vừa yêu cầu vừa loại trừ "${c.value}"`);
      }
    }
  }
  return errs;
}
