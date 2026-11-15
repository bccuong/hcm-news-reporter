import { handle, scheduledCollect, type Env } from './handler';

export default {
  fetch(req: Request, env: Env): Promise<Response> {
    return handle(req, env);
  },
  /** cron trigger (wrangler.toml): hourly automatic collection, unless switched off on the web */
  async scheduled(_event: unknown, env: Env, ctx: { waitUntil(p: Promise<unknown>): void }): Promise<void> {
    ctx.waitUntil(scheduledCollect(env));
  },
};
