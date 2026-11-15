import { promises as fs } from 'node:fs';
import path from 'node:path';

/** Atomic write: temp file + fsync + rename. */
export async function writeFileAtomic(file: string, data: string | Uint8Array): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  const fh = await fs.open(tmp, 'w');
  try {
    await fh.writeFile(data);
    await fh.sync();
  } finally {
    await fh.close();
  }
  await fs.rename(tmp, file);
}

export async function writeJsonAtomic(file: string, value: unknown): Promise<void> {
  await writeFileAtomic(file, JSON.stringify(value, null, 2));
}

export async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8')) as T;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw e;
  }
}

export async function appendJsonl(file: string, rows: unknown[]): Promise<void> {
  if (!rows.length) return;
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.appendFile(file, rows.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8');
}

export async function readJsonl<T>(file: string): Promise<T[]> {
  try {
    const txt = await fs.readFile(file, 'utf8');
    return txt
      .split('\n')
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l) as T);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw e;
  }
}

/** Resolve a user/API-supplied relative name inside a root, refusing traversal. */
export function safeJoin(root: string, ...parts: string[]): string {
  for (const p of parts) {
    if (!p || p.includes('\0') || /(^|[\\/])\.\.([\\/]|$)/.test(p) || path.isAbsolute(p)) {
      throw new Error('PATH_TRAVERSAL');
    }
  }
  const full = path.resolve(root, ...parts);
  const rootAbs = path.resolve(root);
  if (full !== rootAbs && !full.startsWith(rootAbs + path.sep)) throw new Error('PATH_TRAVERSAL');
  return full;
}

/** Simple async mutex keyed by string to serialize writers of the same document. */
const chains = new Map<string, Promise<unknown>>();
export function serialized<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = chains.get(key) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  chains.set(key, next.catch(() => undefined));
  return next;
}
