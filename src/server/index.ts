import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const port = Number(process.env.HCM_PORT ?? 5178);
const HOST = '127.0.0.1'; // loopback only – never 0.0.0.0

const { app } = await createApp({
  root: process.env.HCM_DATA_ROOT ? path.resolve(process.env.HCM_DATA_ROOT) : root,
  seedWebsitesTxt: readFileSync(path.join(root, 'src', 'domain', 'data', 'skill-websites.txt'), 'utf8'),
  webDist: path.join(root, 'dist', 'web'),
});

await app.listen({ host: HOST, port });
console.log(`News Reporter API: http://${HOST}:${port}  (UI: http://${HOST}:${port}/ sau khi build, hoặc http://127.0.0.1:5173 khi chạy npm run dev)`);
