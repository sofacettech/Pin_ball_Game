// Server-only module. Never import this file from src/ or public/.
const productionOrigin = 'https://backend-production-082b.up.railway.app';
export class ServiceError extends Error {
 constructor(status, message) { super(message); this.status = status; }
}
const unavailable = 'SO FACET is temporarily unavailable. Please try again later.';
const messages = {
 invalid_phone: 'Please use a valid Indian phone number (+91).',
 rate_limited: 'Too many requests. Please wait a minute and try again.',
 rewards_not_configured: 'Membership is temporarily unavailable. Please try again later.',
 invalid_token: 'Your rewards session expired. Please try again.'
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
function valid(condition) { if (!condition) throw new ServiceError(503, unavailable); }
function integer(value) { return Number.isSafeInteger(value) && value >= 0; }
async function call(path, { body, token } = {}) {
 const { key, base } = configuration();
 for (let attempt = 0; attempt < 3; attempt++) {
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
   if (attempt === 2) throw new ServiceError(503, 'Unable to reach SO FACET. Please try again later.');
   await sleep(250 * 3 ** attempt); continue;
  }
  const data = await response.json().catch(() => null);
  if (response.ok) { valid(data && typeof data === 'object' && !Array.isArray(data)); return data; }
  if ((response.status >= 500 || response.status === 429) && attempt < 2) {
   const retryAfter = Number(response.headers.get('retry-after'));
   await sleep(Math.max(250 * 3 ** attempt, Number.isFinite(retryAfter) ? Math.min(5000, retryAfter * 1000) : 0));
   continue;
  }
  // Do not relay upstream bodies, headers, tokens, or diagnostics to the browser.
  throw new ServiceError(response.status === 400 ? 400 : response.status === 429 ? 429 : 503, messages[data?.error] || unavailable);
 }
}
export async function authenticatePhone(phone) {
 const data = await call('/rewards/auth', { body: { phone } });
 valid(typeof data.token === 'string' && data.token.length > 0 && typeof data.customer_id === 'string' && data.customer_id.length > 0 && integer(data.balance) && typeof data.created === 'boolean');
 return { token: data.token, customer_id: data.customer_id, balance: data.balance, created: data.created };
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
export async function awardPoints({ phone, points, eventId }) {
 if (!Number.isSafeInteger(points) || points <= 0 || typeof eventId !== 'string' || !eventId.trim() || eventId.length > 160) throw new ServiceError(400, 'Positive integer points and a stable eventId are required.');
 const { token } = await authenticatePhone(phone);
 const data = await call('/rewards/points', { token, body: { points, idempotency_key: 'facet-pinball:' + eventId, reason: 'pinball-verified-event', external_ref: eventId, metadata: { game: 'facet-pinball' } } });
 valid(integer(data.balance) && integer(data.lifetime_earned) && typeof data.transaction_id === 'string' && data.transaction_id.length > 0 && typeof data.replayed === 'boolean');
 return { balance: data.balance, lifetime_earned: data.lifetime_earned, transaction_id: data.transaction_id, replayed: data.replayed };
}
