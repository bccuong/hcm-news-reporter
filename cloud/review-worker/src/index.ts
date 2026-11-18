import { handle, scheduledCollect, type Env } from './handler';
export { ReviewPeriod } from './handler';

export default {
  fetch(req: Request, env: Env): Promise<Response> {
    return handle(req, env);
  },
  /** cron trigger (wrangler.toml, every 5 minutes): collection at the fixed times ticked on the web (src/domain/schedule.ts) */
  async scheduled(_event: unknown, env: Env, ctx: { waitUntil(p: Promise<unknown>): void }): Promise<void> {
    ctx.waitUntil(scheduledCollect(env));
  },
};
