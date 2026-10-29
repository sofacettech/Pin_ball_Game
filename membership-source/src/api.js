export async function request(path, body, signal) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  const timeout = setTimeout(abort, 90000);
  try {
    const response = await fetch(path, {
      method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin',
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body), signal: controller.signal,
    });
    const result = await response.json().catch(() => null);
    if (!response.ok || !result || typeof result !== 'object') throw new Error((result?.message || 'The service is unavailable. Please try again.').replace(/\bmembership\b/gi,'account'));
    return result;
  } catch (error) {
    if (error.name === 'AbortError' && !signal?.aborted) throw new Error('The request timed out. Please try again.');
    throw error;
  } finally {
    clearTimeout(timeout); signal?.removeEventListener('abort', abort);
  }
}

export function normalisePhone(value) {
  if (typeof value !== 'string' || !/^[+\d\s().-]+$/.test(value.trim())) return null;
  let digits = value.replace(/\D/g, '');
  if (/^0\d{10}$/.test(digits)) digits = digits.slice(1);
  if (/^91\d{10}$/.test(digits)) digits = digits.slice(2);
  return /^\d{10}$/.test(digits) ? '+91' + digits : null;
}

export function isAdult(value, today = new Date()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number), born = new Date(year, month - 1, day);
  if (year < 1900 || born.getFullYear() !== year || born.getMonth() !== month - 1 || born.getDate() !== day) return false;
  const age = today.getFullYear() - year - (today.getMonth() < month - 1 || today.getMonth() === month - 1 && today.getDate() < day ? 1 : 0);
  return age >= 18;
}

export function pendingResult(result) {
  if (!result || result.status !== 'completed' || !Number.isSafeInteger(result.points) || result.points < 0 || result.rewardValue !== result.points / 10 || !Number.isFinite(result.completedAt)) return null;
  if (result.gameId !== undefined && (typeof result.gameId !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(result.gameId))) return null;
  return Object.freeze({ points: result.points, rewardValue: result.points / 10, completedAt: result.completedAt, gameId: result.gameId, status: 'completed' });
}
