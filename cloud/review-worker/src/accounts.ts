/**
 * Reviewer accounts (20/11/2026): user name + password instead of one shared access code. Stored in the review KV
 * (key cfg:users), passwords as salted PBKDF2-SHA256 hashes – never in the repository, which is public. A login
 * returns a session token ("sess_…", KV sess:<token>, one year) that the web sends where it used to send the code,
 * so every other endpoint is unchanged. The old shared code still works (an admin session).
 */
export interface UserRecord { u: string; name: string; role: 'admin' | 'reviewer'; salt: string; hash: string; at: string; by: string }
export interface Session { u: string; name: string; role: 'admin' | 'reviewer' }
interface KV { get(k: string): Promise<string | null>; put(k: string, v: string, o?: { expirationTtl?: number; metadata?: unknown }): Promise<void>; delete(k: string): Promise<void> }

export const USERS_KEY = 'cfg:users';
const SESSION_TTL = 365 * 86400;
/** Workers free plan: ~10 ms CPU per request – a moderate iteration count (the user accepted low security) */
const ITERATIONS = 5000;
export const USER_RE = /^[a-z0-9][a-z0-9._-]{1,31}$/;

const hex = (b: ArrayBuffer | Uint8Array) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
export function newSalt(): string {
  return hex(crypto.getRandomValues(new Uint8Array(16)));
}
export async function hashPassword(password: string, salt: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: new TextEncoder().encode(salt), iterations: ITERATIONS }, key, 256);
  return hex(bits);
}
export async function getUsers(kv: KV): Promise<UserRecord[]> {
  const v = await kv.get(USERS_KEY);
  return v ? (JSON.parse(v) as UserRecord[]) : [];
}
export const saveUsers = (kv: KV, list: UserRecord[]) => kv.put(USERS_KEY, JSON.stringify(list));
export const publicUser = (x: UserRecord) => ({ u: x.u, name: x.name, role: x.role, at: x.at, by: x.by });

/** user name + password → a new session token, or null */
export async function login(kv: KV, username: string, password: string): Promise<{ token: string; session: Session } | null> {
  const u = username.trim().toLowerCase();
  const rec = (await getUsers(kv)).find((x) => x.u === u);
  if (!rec || (await hashPassword(password, rec.salt)) !== rec.hash) return null;
  const token = `sess_${hex(crypto.getRandomValues(new Uint8Array(24)))}`;
  const session: Session = { u: rec.u, name: rec.name, role: rec.role };
  await kv.put(`sess:${token}`, JSON.stringify(session), { expirationTtl: SESSION_TTL });
  return { token, session };
}
export async function sessionOf(kv: KV, token: string): Promise<Session | null> {
  if (!/^sess_[0-9a-f]{48}$/.test(token)) return null;
  const v = await kv.get(`sess:${token}`);
  if (!v) return null;
  const s = JSON.parse(v) as Session;
  // a deleted user or a changed role takes effect at once
  const rec = (await getUsers(kv)).find((x) => x.u === s.u);
  return rec ? { u: rec.u, name: rec.name, role: rec.role } : null;
}
