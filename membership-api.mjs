import { randomBytes, randomUUID } from 'node:crypto';
import { ServiceError, authenticatePhone, awardPoints } from './rewards.mjs';
import { otpProvider } from './membership-otp.mjs';
import { isAdult } from './membership-source/src/api.js';

const fail = (status, message) => { throw new ServiceError(status, message); };
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
function text(value, max, label) {
  if (typeof value !== 'string') fail(400, 'Please enter ' + label + '.');
  const clean = value.trim().replace(/\s+/g, ' ');
  if (!clean || clean.length > max || /[\x00-\x1f\x7f]/.test(clean)) fail(400, 'Please check ' + label + '.');
  return clean;
}
function publicUrl(value) {
  if (!value) return null;
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password ? url.href : null; } catch { return null; }
}

export function createMembershipApi({ getStore, commit, phone, publicPlayer, provider = otpProvider, authenticate = authenticatePhone, award = awardPoints }) {
  const challenges = new Map(), proofs = new Map(), cooldowns = new Map(), jobs = new Map();
  const policies = () => ({ terms: publicUrl(process.env.MEMBERSHIP_TERMS_URL), privacy: publicUrl(process.env.MEMBERSHIP_PRIVACY_URL) });
  const configured = () => typeof provider.request === 'function' && typeof provider.verify === 'function';
  function cleanup() {
    const now = Date.now();
    for (const map of [challenges, proofs]) for (const [key, item] of map) if (item.expiresAt < now) map.delete(key);
    for (const [key, until] of cooldowns) if (until < now) cooldowns.delete(key);
  }
  async function saveReward(customerId, normalized, gameId, id) {
    const previous = jobs.get(customerId) || Promise.resolve();
    const job = previous.catch(() => {}).then(async () => {
      const game = getStore().games[gameId];
      if (!game || game.player !== id || !game.verified || !Number.isSafeInteger(game.score) || game.score < 0) fail(409, 'Your score is still being verified. Please try again.');
      if (game.rewardCustomer && game.rewardCustomer !== customerId) fail(409, 'This game has already been saved to another membership.');
      commit(() => {
        const store = getStore(); store.rewardAccounts ??= {};
        store.rewardAccounts[customerId] ??= { bestScore: 0, creditedUnits: 0 };
        store.rewardAccounts[customerId].bestScore = Math.max(store.rewardAccounts[customerId].bestScore, game.score);
        game.rewardCustomer = customerId;
      });
      let ledger = getStore().rewardAccounts[customerId];
      // The supplied API grants ₹1 per integer unit; ten game points equal one API unit.
      while (ledger.pending || Math.floor(ledger.bestScore / 10) > ledger.creditedUnits) {
        if (!ledger.pending) commit(() => {
          const current = getStore().rewardAccounts[customerId], target = Math.floor(current.bestScore / 10);
          current.pending = { eventId: 'best:' + customerId + ':' + target, points: target - current.creditedUnits, target };
        });
        const pending = getStore().rewardAccounts[customerId].pending;
        const result = await award({ phone: normalized, points: pending.points, eventId: pending.eventId });
        commit(() => {
          const current = getStore().rewardAccounts[customerId];
          current.creditedUnits = pending.target; current.balance = result.balance;
          delete current.pending;
        });
        ledger = getStore().rewardAccounts[customerId];
      }
      return { pointsSaved: true, savedPoints: ledger.creditedUnits * 10, bestPoints: ledger.bestScore, remainingPoints: ledger.bestScore % 10 };
    });
    jobs.set(customerId, job);
    try { return await job; } finally { if (jobs.get(customerId) === job) jobs.delete(customerId); }
  }
  return async (path, data, id) => {
    cleanup();
    if (path === '/api/membership/config') return { otpAvailable: configured(), policies: policies(), pointsPerRupee: 10 };
    if (!data || typeof data !== 'object' || Array.isArray(data)) fail(400, 'Please send valid membership details.');
    if (path === '/api/membership/rewards') {
      if (Object.keys(data).some(key => key !== 'gameId') || typeof data.gameId !== 'string' || !uuid.test(data.gameId)) fail(400, 'Submit the completed game ID only.');
      const profile = getStore().players[id]?.profile;
      if (typeof profile?.customerId !== 'string' || !profile.customerId || typeof profile.phone !== 'string') fail(401, 'Please complete your membership first.');
      return { success: true, ...await saveReward(profile.customerId, phone(profile.phone), data.gameId, id) };
    }
    if (!configured()) fail(503, 'Phone verification is not connected yet. Your points have not been saved. Please try again later.');
    if (path === '/api/membership/otp/request') {
      const normalized = phone(data.phoneNumber), now = Date.now();
      if (cooldowns.get(id) > now || cooldowns.get(normalized) > now) fail(429, 'Please wait 30 seconds before requesting another code.');
      cooldowns.set(id, now + 30000); cooldowns.set(normalized, now + 30000);
      const result = await provider.request({ phone: normalized });
      if (!result || typeof result.challengeId !== 'string' || !result.challengeId || !Number.isFinite(result.expiresIn) || result.expiresIn <= 0) fail(503, 'We couldn’t send your code. Please try again.');
      const challengeId = randomUUID(), expiresIn = Math.min(300, result.expiresIn);
      for (const [key, item] of challenges) if (item.player === id) challenges.delete(key);
      challenges.set(challengeId, { player: id, phone: normalized, providerId: result.challengeId, attempts: 0, expiresAt: Date.now() + expiresIn * 1000 });
      return { success: true, challengeId, expiresIn, resendAfter: 30 };
    }
    if (path === '/api/membership/otp/verify') {
      const normalized = phone(data.phoneNumber), challenge = challenges.get(data.challengeId);
      if (!challenge || challenge.player !== id || challenge.phone !== normalized || challenge.expiresAt < Date.now()) fail(410, 'This code expired. Please request a new one.');
      if (typeof data.otp !== 'string' || !/^\d{6}$/.test(data.otp)) fail(400, 'Enter the six-digit code.');
      if (++challenge.attempts > 5) { challenges.delete(data.challengeId); fail(429, 'Too many attempts. Please request a new code.'); }
      const result = await provider.verify({ phone: normalized, otp: data.otp, challengeId: challenge.providerId });
      if (result?.verified !== true) fail(400, 'That code doesn’t match. Check it and try again.');
      challenges.delete(data.challengeId);
      const token = randomBytes(32).toString('hex');
      proofs.set(token, { player: id, phone: normalized, expiresAt: Date.now() + 15 * 60000 });
      return { verified: true, verificationToken: token };
    }
    if (path === '/api/membership') {
      if (!data || typeof data !== 'object' || Object.keys(data).some(key => !['name','leaderboardName','email','dateOfBirth','city','termsAccepted','marketingConsent','phoneNumber','verificationToken','gameId'].includes(key))) fail(400, 'Please submit membership details and the game ID only.');
      const normalized = phone(data.phoneNumber), proof = proofs.get(data.verificationToken);
      if (!proof || proof.player !== id || proof.phone !== normalized || proof.expiresAt < Date.now()) fail(401, 'Please verify your phone number again.');
      const profile = { name: text(data.name, 80, 'your name'), leaderboardName: text(data.leaderboardName, 30, 'your leaderboard name') };
      if (data.city !== undefined) profile.city = text(data.city, 100, 'your city');
      if (typeof data.email !== 'string' || data.email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) fail(400, 'Please enter a valid email address.');
      // The single-screen form uses the required 18+ declaration; validate dates from older clients when supplied.
      if (data.dateOfBirth !== undefined) {
        if (typeof data.dateOfBirth !== 'string' || !isAdult(data.dateOfBirth)) fail(400, 'You must be at least 18 years old to participate.');
        profile.birthDate = data.dateOfBirth;
      }
      if (data.termsAccepted !== true || typeof data.marketingConsent !== 'boolean') fail(400, 'Please accept the terms and check your contact preferences.');
      const policy = policies(); if (!policy.terms || !policy.privacy) fail(503, 'Membership terms are not available yet. Please try again later.');
      if (data.gameId !== undefined) {
        if (typeof data.gameId !== 'string' || !uuid.test(data.gameId)) fail(400, 'This game session is invalid.');
        const game = getStore().games[data.gameId];
        if (!game || game.player !== id || !game.verified) fail(409, 'Your score is still being verified. Please try again.');
      }
      const customer = await authenticate(normalized);
      if (data.gameId && getStore().games[data.gameId].rewardCustomer && getStore().games[data.gameId].rewardCustomer !== customer.customer_id) fail(409, 'This game has already been saved to another membership.');
      commit(() => {
        const player = getStore().players[id]; player.name = profile.leaderboardName;
        player.profile = { ...player.profile, ...profile, customerId: customer.customer_id, phone: normalized, email: data.email.trim(), memberConsent: true, contestConsent: true, marketingConsent: data.marketingConsent, termsUrl: policy.terms, privacyUrl: policy.privacy, registeredAt: new Date().toISOString() };
      });
      const reward = data.gameId ? await saveReward(customer.customer_id, normalized, data.gameId, id) : { pointsSaved: false, savedPoints: 0, bestPoints: 0, remainingPoints: 0 };
      return { success: true, player: publicPlayer(getStore().players[id]), ...reward };
    }
    fail(404, 'This endpoint was not found.');
  };
}
