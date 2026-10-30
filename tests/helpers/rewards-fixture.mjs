import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const member = 'a'.repeat(64), other = 'b'.repeat(64);
export const gameId = 'ab001122-0000-4000-8000-001122334455';
export const registration = { phoneNumber: '+919876543210', name: 'Test Member', consent: true };
export const profile = { name: 'Test Member', leaderboardName: 'Test M.', email: 'test@example.invalid', termsAccepted: true, marketingConsent: false, phoneNumber: registration.phoneNumber, gameId };

export async function withRewardsSite(check, { returningMember = false } = {}) {
  const events = [], awards = new Map(), registrations = new Map();
  const state = { sendError: null, verifyError: null, scoreError: null, pointsError: null, profileWriteError: null, loseAwardResponse: false, expiredToken: false, resendAfter: 60,
    profile: { customer_id: 'cus_fixture', phone: registration.phoneNumber, name: profile.name, email: returningMember ? profile.email : '', leaderboard_name: 'Test M.', marketing_consent: false, terms_accepted: returningMember, profile_complete: returningMember } };
  const key = 'fixture-partner-key';
  const token = () => 'eyJhbGciOiJIUzI1NiJ9.' + Buffer.from(JSON.stringify({ sub: 'cus_fixture', otp_verified: true, exp: Math.floor(Date.now() / 1000) + 1800 })).toString('base64url') + '.fixture-signature';
  const send = (res, status, data, headers = {}) => { res.writeHead(status, { 'Content-Type': 'application/json', ...headers }); res.end(JSON.stringify(data)); };
  const upstream = createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk;
    const body = raw ? JSON.parse(raw) : undefined;
    const path = new URL(req.url, 'http://localhost').pathname;
    events.push({ path, body, authorization: req.headers.authorization });
    if (req.headers['x-rewards-key'] !== key) return send(res, 401, { error: 'unauthorized' });
    if (path === '/rewards/auth') {
      if (state.sendError) return send(res, state.sendError.status, { error: state.sendError.code }, state.sendError.headers);
      assert.equal(body.consent, true); if (body.name !== undefined) assert.equal(body.name, registration.name);
      assert.equal(body.phone, registration.phoneNumber); assert.equal(body.email, undefined);
      for (const pending of registrations.values()) pending.consumed = true;
      const id = 'rreg_' + registrations.size;
      registrations.set(id, { attempts: 0, consumed: false });
      return send(res, 202, { registration_id: id, status: 'pending_otp', otp_required: true, otp_sent: true, delivery_channel: 'whatsapp', expires_at: new Date(Date.now() + 300000).toISOString(), resend_after_seconds: state.resendAfter });
    }
    if (path === '/rewards/auth/verify') {
      if (state.verifyError) return send(res, state.verifyError.status, { error: state.verifyError.code });
      const item = registrations.get(body.registration_id);
      if (!item || item.consumed) return send(res, 401, { error: 'invalid_otp' });
      if (++item.attempts > 5) return send(res, 429, { error: 'otp_attempts_exceeded' });
      if (body.otp !== '012345') return send(res, 401, { error: 'invalid_otp' });
      item.consumed = true;
      return send(res, 201, { token: token(), customer_id: 'cus_fixture', balance: 0, created: true });
    }
    if (!/^Bearer ey/.test(req.headers.authorization || '') || state.expiredToken) return send(res, 401, { error: 'invalid_token' });
    if (path === '/rewards/profile') {
      if (body) {
        if (state.profileWriteError) return send(res, state.profileWriteError.status, { error: state.profileWriteError.code });
        Object.assign(state.profile, body, { profile_complete: true });
      }
      return send(res, 200, state.profile);
    }
    if (path === '/rewards/score') {
      if (state.scoreError) return send(res, state.scoreError.status, { error: state.scoreError.code });
      const balance = [...awards.values()].reduce((a,b) => a+b, 0);
      return send(res, 200, { balance, lifetime_earned: balance, rank: null });
    }
    if (path === '/rewards/points') {
      if (state.pointsError) return send(res, state.pointsError.status, { error: state.pointsError.code });
      const replayed = awards.has(body.idempotency_key);
      if (!replayed) awards.set(body.idempotency_key, body.points);
      if (state.loseAwardResponse) { state.loseAwardResponse = false; res.destroy(); return; }
      const balance = [...awards.values()].reduce((a,b) => a+b, 0);
      return send(res, 200, { balance, lifetime_earned: balance, transaction_id: 'ptx_fixture', replayed });
    }
    send(res, 404, { error: 'not_found' });
  });
  upstream.listen(0, '127.0.0.1'); await once(upstream, 'listening');
  const directory = await mkdtemp(join(tmpdir(), 'sofacet-rewards-test-'));
  await writeFile(join(directory, 'players.json'), JSON.stringify({ players: { [member]: { name: 'Guest', ...(returningMember ? { profile: { name: profile.name, email: profile.email, phone: profile.phoneNumber, customerId: 'cus_fixture', marketingConsent: false } } : {}) }, [other]: { name: 'Other guest' } }, games: { [gameId]: { player: member, verified: true, score: 3205 } } }));
  const child = spawn(process.execPath, ['server.mjs'], { cwd: new URL('../../', import.meta.url), env: { ...process.env, NODE_ENV: 'test', HOST: '127.0.0.1', PORT: '0', APP_ORIGIN: '', DATA_DIR: directory, REWARDS_API_BASE: 'http://127.0.0.1:' + upstream.address().port, REWARDS_API_KEY: key, REWARDS_ADMIN_SECRET: '', MEMBERSHIP_TERMS_URL: 'https://example.invalid/terms', MEMBERSHIP_PRIVACY_URL: 'https://example.invalid/privacy' }, stdio: ['ignore', 'pipe', 'pipe'] });
  const exited = once(child, 'exit');
  let logs = ''; child.stdout.on('data', data => { logs += data; }); child.stderr.on('data', data => { logs += data; });
  try {
    const ready = await Promise.race([once(child.stdout, 'data'), exited.then(() => { throw Error('Fixture site stopped: ' + logs); }), new Promise((_, reject) => { const timer = setTimeout(() => reject(Error('Fixture site timeout')), 10000); timer.unref(); })]);
    const origin = /http:\/\/127\.0\.0\.1:\d+/.exec(String(ready[0]))[0];
    const request = async (path, body, id = member, extraHeaders = {}) => {
      const response = await fetch(origin + path, { method: body === undefined ? 'GET' : 'POST', headers: { Cookie: 'sofacet_pinball_player=' + id, ...(body === undefined ? {} : { Origin: origin, 'Content-Type': 'application/json' }), ...extraHeaders }, body: body === undefined ? undefined : JSON.stringify(body) });
      return { status: response.status, data: await response.json(), headers: response.headers };
    };
    await check({ origin, request, events, awards, state, readStore: async () => JSON.parse(await readFile(join(directory, 'players.json'), 'utf8')) });
    assert.ok(!logs.includes(key) && !logs.includes('fixture-signature') && !logs.includes('012345'), 'Sensitive values must not be logged');
  } finally {
    child.kill('SIGTERM'); await exited;
    await new Promise(resolve => upstream.close(resolve)); await rm(directory, { recursive: true, force: true });
  }
}
