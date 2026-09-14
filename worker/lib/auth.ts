// Single-owner authentication: password login → HMAC-signed, HttpOnly session cookie.

const COOKIE = "session";
const SESSION_DAYS = 30;
const encoder = new TextEncoder();

function b64url(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = "";
  for (const b of arr) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64url(s: string): Uint8Array {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

function hmacKey(secret: string, usage: ("sign" | "verify")[]): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, usage);
}

export function authConfigured(env: Env): boolean {
  return Boolean(env.APP_PASSWORD && env.SESSION_SECRET && env.SESSION_SECRET.length >= 16);
}

/** Constant-time password comparison (HMAC both values so lengths match). */
export async function passwordMatches(env: Env, candidate: string): Promise<boolean> {
  const key = await hmacKey(env.SESSION_SECRET, ["sign"]);
  const [a, b] = await Promise.all([
    crypto.subtle.sign("HMAC", key, encoder.encode(candidate)),
    crypto.subtle.sign("HMAC", key, encoder.encode(env.APP_PASSWORD)),
  ]);
  return crypto.subtle.timingSafeEqual(a, b);
}

export async function createSessionCookie(env: Env, secure: boolean): Promise<string> {
  const payload = b64url(encoder.encode(JSON.stringify({ exp: Date.now() + SESSION_DAYS * 86_400_000, n: crypto.randomUUID() })));
  const key = await hmacKey(env.SESSION_SECRET, ["sign"]);
  const sig = b64url(await crypto.subtle.sign("HMAC", key, encoder.encode(payload)));
  return serializeCookie(`${payload}.${sig}`, SESSION_DAYS * 86_400, secure);
}

export function clearSessionCookie(secure: boolean): string {
  return serializeCookie("", 0, secure);
}

function serializeCookie(value: string, maxAge: number, secure: boolean): string {
  return `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure ? "; Secure" : ""}`;
}

export async function hasValidSession(env: Env, cookieHeader: string | null): Promise<boolean> {
  if (!authConfigured(env) || !cookieHeader) return false;
  const token = cookieHeader
    .split(/;\s*/)
    .find((c) => c.startsWith(`${COOKIE}=`))
    ?.slice(COOKIE.length + 1);
  if (!token) return false;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return false;
  try {
    const key = await hmacKey(env.SESSION_SECRET, ["verify"]);
    const valid = await crypto.subtle.verify("HMAC", key, fromB64url(sig), encoder.encode(payload));
    if (!valid) return false;
    const { exp } = JSON.parse(new TextDecoder().decode(fromB64url(payload))) as { exp: number };
    return typeof exp === "number" && exp > Date.now();
  } catch {
    return false;
  }
}
