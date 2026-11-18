/**
 * "Hỏi nhanh" runs the whole relevance filter over every story of a period: in this worker thread, so picking a
 * period or scrolling never freezes while it works (user, 18/11/2026).
 */
import type { LearnedModel } from '../../src/domain/learn';
import type { Article, Settings } from '../../src/domain/schemas';
import { uncertainStories } from '../../src/domain/suggest';

export interface AskRequest { id: number; arts: Article[]; settings: Settings; model?: LearnedModel | null }
export type AskReply = { id: number; ok: true; items: Array<{ articleId: string; status: string; why: string; weight: number }> } | { id: number; ok: false; error: string };

self.onmessage = (e: MessageEvent<AskRequest>) => {
  const { id, arts, settings, model } = e.data;
  let reply: AskReply;
  try {
    reply = { id, ok: true, items: uncertainStories(arts, settings, new Set(), 40, model).map((x) => ({ articleId: x.article.id, status: x.status, why: x.why, weight: x.weight })) };
  } catch (err) {
    reply = { id, ok: false, error: String((err as Error)?.message ?? err) };
  }
  (self as unknown as Worker).postMessage(reply);
};
