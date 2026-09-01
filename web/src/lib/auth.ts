/**
 * Shared-password session tokens.
 *
 * Deliberately Web Crypto only, no `node:crypto`: this runs in Next.js
 * middleware on the Edge runtime, where the node module is unavailable.
 *
 * Token format is `<expiry-ms>.<hmac>`. The expiry lives *inside* the signed
 * payload, so a stolen cookie dies on schedule rather than being valid forever.
 */

export const SESSION_COOKIE = "soclaas_session";
export const SESSION_MAX_AGE_S = 60 * 60 * 24 * 30; // 30 days

const encoder = new TextEncoder();

function base64url(bytes: ArrayBuffer): string {
  let binary = "";
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function sign(payload: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return base64url(await crypto.subtle.sign("HMAC", key, encoder.encode(payload)));
}

/** Constant-time compare, so signatures can't be guessed byte by byte. */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function createSessionToken(secret: string): Promise<string> {
  const expiresAt = String(Date.now() + SESSION_MAX_AGE_S * 1000);
  return `${expiresAt}.${await sign(expiresAt, secret)}`;
}

export async function verifySessionToken(
  token: string | undefined,
  secret: string,
): Promise<boolean> {
  if (!token) return false;
  const separator = token.lastIndexOf(".");
  if (separator <= 0) return false;

  const payload = token.slice(0, separator);
  const signature = token.slice(separator + 1);

  if (!safeEqual(signature, await sign(payload, secret))) return false;

  const expiresAt = Number(payload);
  return Number.isFinite(expiresAt) && expiresAt > Date.now();
}
