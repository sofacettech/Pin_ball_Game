// Server-only module. Never import this file from src/ or public/.
const productionOrigin = 'https://backend-production-082b.up.railway.app';
export class ServiceError extends Error {
 constructor(status, message, code, retryAfter) { super(message); this.status = status; this.code = code; this.retryAfter = retryAfter; }
}
const unavailable = 'SO FACET is temporarily unavailable. Please try again later.';
const messages = {
 invalid_phone: 'Please use a valid Indian phone number (+91).',
 rate_limited: 'Too many requests. Please wait a minute and try again.',
 rewards_not_configured: 'Membership is temporarily unavailable. Please try again later.',
 invalid_token: 'Please verify your phone again to save your points.',
 invalid_otp: 'That code doesn’t match or has already been used. Check it or request a new code.',
 otp_expired: 'This code expired. Please request a new one.',
 otp_attempts_exceeded: 'Too many attempts. Please request a new code.',
 otp_delivery_failed: 'We couldn’t deliver your code. Please wait before trying again.',
 otp_verification_unavailable: 'Code verification is temporarily unavailable. Please try again.',
 otp_not_configured: 'Phone verification is temporarily unavailable. Please try again later.',
 consent_required: 'Please agree to receive a verification code.',
 invalid_dob: 'Please check your date of birth.',
 invalid_nationality: 'Please check your nationality.',
 invalid_request: 'Please check the details and try again.',
 customer_not_found: 'Your rewards account could not be found. Please contact SO FACET.'
};
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
function configuration() {
 const key = process.env.REWARDS_API_KEY?.trim();
 if (!key) throw new ServiceError(503, 'Membership is not configured yet. Your game remains playable.');
 let base;
 try { base = new URL(process.env.REWARDS_API_BASE || productionOrigin); }
 catch { throw new ServiceError(503, unavailable); }
 // Only the documented backend receives the integration key. Loopback is for local tests.
 const local = process.env.NODE_ENV !== 'production' && base.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname);
 if ((!local && base.origin !== productionOrigin) || base.username || base.password || base.search || base.hash || base.pathname !== '/') throw new ServiceError(503, unavailable);
 return { key, base };
}
export function rewardsConfigured() { try { configuration(); return true; } catch { return false; } }
function valid(condition) { if (!condition) throw new ServiceError(503, unavailable); }
function integer(value) { return Number.isSafeInteger(value) && value >= 0; }
async function call(path, { body, token, retry = true } = {}) {
 const { key, base } = configuration();
 const attempts = retry ? 3 : 1;
 for (let attempt = 0; attempt < attempts; attempt++) {
  let response;
  try {
   response = await fetch(new URL(path, base), {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'x-rewards-key': key, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
    // A redirect must never forward credentials to another host.
    redirect: 'error', signal: AbortSignal.timeout(8000)
   });
  } catch {
   if (attempt === attempts - 1) throw new ServiceError(503, 'Unable to reach SO FACET. Please try again later.');
   await sleep(250 * 3 ** attempt); continue;
  }
  const data = await response.json().catch(() => null);
  if (response.ok) { valid(data && typeof data === 'object' && !Array.isArray(data)); return data; }
  if (response.status >= 500 && attempt < attempts - 1) {
   await sleep(250 * 3 ** attempt);
   continue;
  }
  // Do not relay upstream bodies, headers, tokens, or diagnostics to the browser.
  const code = Object.hasOwn(messages, data?.error) ? data.error : undefined;
  const status = response.status === 401 && code !== 'invalid_token' && code !== 'invalid_otp' ? 503 : [400,401,404,409,410,429,502,503].includes(response.status) ? response.status : 503;
  const header = response.headers.get('retry-after');
  const delay = header === null ? NaN : /^\d+$/.test(header) ? Number(header) : Math.ceil((Date.parse(header) - Date.now()) / 1000);
  throw new ServiceError(status, messages[code] || unavailable, code, Number.isFinite(delay) ? Math.max(0, delay) : undefined);
 }
}
export async function requestRewardsOtp({ phone, consent, name, dob }) {
 // Sending is not idempotent: never automatically repeat an ambiguous send.
 const data = await call('/rewards/auth', { body: { phone, consent, ...(name ? { name } : {}), ...(dob ? { dob } : {}) }, retry: false });
 valid(typeof data.registration_id === 'string' && data.registration_id.length > 0 && data.status === 'pending_otp' && data.otp_required === true && data.otp_sent === true && ['whatsapp','sms'].includes(data.delivery_channel) && Date.parse(data.expires_at) > Date.now() && Number.isSafeInteger(data.resend_after_seconds) && data.resend_after_seconds >= 0);
 return { challengeId: data.registration_id, expiresIn: Math.min(300, (Date.parse(data.expires_at) - Date.now()) / 1000), resendAfter: data.resend_after_seconds, deliveryChannel: data.delivery_channel };
}
export async function verifyRewardsOtp({ challengeId, otp }) {
 const data = await call('/rewards/auth/verify', { body: { registration_id: challengeId, otp }, retry: false });
 valid(typeof data.token === 'string' && data.token.length > 0 && typeof data.customer_id === 'string' && data.customer_id.length > 0 && integer(data.balance) && typeof data.created === 'boolean');
 // Decode expiry only to plan re-verification. The upstream score/points API validates the JWT.
 let claims;
 try { claims = JSON.parse(Buffer.from(data.token.split('.')[1], 'base64url').toString()); } catch { valid(false); }
 valid(Number.isSafeInteger(claims.exp) && claims.exp * 1000 > Date.now());
 return { verified: true, token: data.token, customer_id: data.customer_id, balance: data.balance, created: data.created, expiresAt: claims.exp * 1000 };
}
export async function rewardsScore(token) {
 const data = await call('/rewards/score', { token });
 valid(integer(data.balance) && integer(data.lifetime_earned) && (data.rank === null || Number.isSafeInteger(data.rank) && data.rank > 0));
 return { balance: data.balance, lifetime_earned: data.lifetime_earned, rank: data.rank };
}
export async function rewardsLeaderboard() {
 const data = await call('/rewards/leaderboard?limit=100');
 valid(Array.isArray(data.entries) && data.entries.length <= 100);
 const entries = data.entries.map(row => {
  valid(row && Number.isSafeInteger(row.rank) && row.rank > 0 && typeof row.display_name === 'string' && row.display_name.length <= 100 && integer(row.points));
  return { rank: row.rank, display_name: row.display_name, points: row.points, is_you: false };
 });
 // A key-only lookup does not identify a customer, as specified in the API guide.
 return { entries, me: null };
}
// Only a trusted server/admin may call this. Browser scores never become redeemable points.
export async function awardPoints({ token, points, eventId }) {
 if (!Number.isSafeInteger(points) || points <= 0 || typeof eventId !== 'string' || !eventId.trim() || eventId.length > 160) throw new ServiceError(400, 'Positive integer points and a stable eventId are required.');
 if (typeof token !== 'string' || !token) throw new ServiceError(401, messages.invalid_token, 'invalid_token');
 const data = await call('/rewards/points', { token, body: { points, idempotency_key: 'facet-pinball:' + eventId, reason: 'pinball-verified-event', external_ref: eventId, metadata: { game: 'facet-pinball' } } });
 valid(integer(data.balance) && integer(data.lifetime_earned) && typeof data.transaction_id === 'string' && data.transaction_id.length > 0 && typeof data.replayed === 'boolean');
 return { balance: data.balance, lifetime_earned: data.lifetime_earned, transaction_id: data.transaction_id, replayed: data.replayed };
}
