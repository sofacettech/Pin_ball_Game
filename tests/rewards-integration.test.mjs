import test from 'node:test';
import assert from 'node:assert/strict';
import { withRewardsSite, member, other, gameId, registration, profile } from './helpers/rewards-fixture.mjs';

async function verify(request) {
  const sent = await request('/api/membership/otp/request', registration);
  assert.equal(sent.status, 200); assert.equal(sent.data.resendAfter, 60); assert.equal(sent.data.deliveryChannel, 'whatsapp');
  assert.ok(!sent.data.challengeId.startsWith('rreg_'));
  const result = await request('/api/membership/otp/verify', { phoneNumber: registration.phoneNumber, challengeId: sent.data.challengeId, otp: '012345' });
  assert.equal(result.status, 200); assert.equal(result.data.verified, true);
  assert.deepEqual(Object.keys(result.data).sort(), ['verificationToken', 'verified']);
  return result.data.verificationToken;
}

test('HTTP flow registers, verifies leading-zero OTP, reads score, then saves profile and awards once using the JWT', async () => {
  await withRewardsSite(async ({ request, events, awards, readStore, state }) => {
    assert.equal((await request('/api/membership/config')).data.otpAvailable, true);
    assert.equal((await request('/api/membership', profile)).status, 401);
    const verificationToken = await verify(request);
    assert.equal((await request('/api/player')).data.member, false);
    const payload = { ...profile, verificationToken };
    const result = await request('/api/membership', payload);
    assert.equal(result.status, 200); assert.equal(result.data.savedPoints, 3200); assert.equal(result.data.remainingPoints, 5);
    assert.deepEqual(events.map(item => item.path), ['/rewards/auth', '/rewards/auth/verify', '/rewards/score', '/rewards/profile', '/rewards/points']);
    assert.deepEqual(events[1].body, { registration_id: 'rreg_0', otp: '012345' });
    assert.equal(events[2].authorization, events[3].authorization);
    assert.equal(events[4].body.points, 320); assert.equal(events[4].body.phone, undefined);
    assert.equal(events[3].body.email, profile.email); assert.equal(events[3].body.terms_accepted, true);
    const store = await readStore(); assert.equal(store.players[member].profile.email, undefined); assert.equal(state.profile.email, profile.email);
    assert.equal(store.players[member].profile.customerId, 'cus_fixture');
    assert.ok(!JSON.stringify(store).includes('fixture-signature') && !JSON.stringify(store).includes(verificationToken));
    assert.equal((await request('/api/membership', payload, other)).status, 401);
    assert.equal((await request('/api/membership', payload)).status, 200);
    assert.equal((await request('/api/membership/rewards', { gameId })).status, 200);
    assert.equal(awards.size, 1); assert.equal(events.filter(item => item.path === '/rewards/auth').length, 1);
    assert.equal((await request('/api/member', { phone: registration.phoneNumber })).status, 410);
    assert.equal((await request('/api/membership/otp/request', registration, member, { Origin: 'https://example.invalid' })).status, 403);
  });
});

test('wrong, expired, consumed and cross-session codes never grant profile or points access', async () => {
  await withRewardsSite(async ({ request, events, awards, state, readStore }) => {
    const missingConsent = await request('/api/membership/otp/request', { ...registration, consent: false });
    assert.equal(missingConsent.status, 400); assert.equal(events.length, 0);
    const sent = await request('/api/membership/otp/request', registration);
    const data = { phoneNumber: registration.phoneNumber, challengeId: sent.data.challengeId, otp: '000000' };
    assert.equal((await request('/api/membership/otp/verify', data, other)).status, 410);
    const wrong = await request('/api/membership/otp/verify', data);
    assert.equal(wrong.status, 401); assert.equal(wrong.data.code, 'invalid_otp'); assert.equal(wrong.data.verificationToken, undefined);
    state.verifyError = { status: 410, code: 'otp_expired' };
    assert.equal((await request('/api/membership/otp/verify', { ...data, otp: '012345' })).status, 410);
    state.verifyError = null;
    assert.equal((await request('/api/membership/otp/verify', { ...data, otp: '012345' })).status, 410);
    assert.equal((await readStore()).players[member].profile, undefined); assert.equal(awards.size, 0);
    assert.ok(!events.some(item => item.path === '/rewards/points'));
  });
  await withRewardsSite(async ({ request, events }) => {
    const sent=await request('/api/membership/otp/request',registration);
    const data={phoneNumber:registration.phoneNumber,challengeId:sent.data.challengeId,otp:'012345'};
    assert.equal((await request('/api/membership/otp/verify',data)).status,200);
    const replay = await request('/api/membership/otp/verify', data);
    assert.equal(replay.status, 410);
    assert.equal(events.filter(item => item.path === '/rewards/auth/verify').length, 1);
  });
});

test('delivery errors and Retry-After surface without automatic sends or tokens', async () => {
  for (const failure of [{ status: 502, code: 'otp_delivery_failed' }, { status: 429, code: 'rate_limited', headers: { 'Retry-After': '120' } }]) {
    await withRewardsSite(async ({ request, events, state, readStore }) => {
      state.sendError = failure;
      const result = await request('/api/membership/otp/request', registration);
      assert.equal(result.status, failure.status); assert.equal(result.data.code, failure.code);
      assert.equal(result.data.retryAfter, failure.status === 429 ? 120 : 60);
      assert.equal(result.headers.get('retry-after'), String(result.data.retryAfter));
      assert.equal((await request('/api/membership/otp/request', registration)).status, 429);
      assert.equal(events.length, 1); assert.equal((await readStore()).players[member].profile, undefined);
    });
  }
});

test('lost award responses retry with the same JWT and event key, without double credit', async () => {
  await withRewardsSite(async ({ request, events, awards, state }) => {
    const verificationToken = await verify(request); state.loseAwardResponse = true;
    const result = await request('/api/membership', { ...profile, verificationToken });
    assert.equal(result.status, 200); assert.equal(result.data.savedPoints, 3200);
    const attempts = events.filter(item => item.path === '/rewards/points');
    assert.equal(attempts.length, 2); assert.deepEqual(attempts[0], attempts[1]); assert.equal(awards.size, 1);
  });
});

test('invalid JWT requires another OTP and preserves an uncredited award for retry', async () => {
  await withRewardsSite(async ({ request, events, awards, state, readStore }) => {
    const verificationToken = await verify(request); state.pointsError = {status:401,code:'invalid_token'};
    const result = await request('/api/membership', { ...profile, verificationToken });
    assert.equal(result.status, 401); assert.equal(result.data.code, 'invalid_token'); assert.equal(awards.size, 0);
    assert.ok((await readStore()).rewardAccounts.cus_fixture.pending);
    const again = await request('/api/membership/rewards', { gameId });
    assert.equal(again.status, 401); assert.equal(again.data.code, 'rewards_verification_required');
    assert.equal(events.filter(item => item.path === '/rewards/auth').length, 1);
  });
});

test('verified account details persist without changing ownership, scores or reward credits', async () => {
  await withRewardsSite(async ({ request, events, awards, readStore, state }) => {
    const details = { name: 'Updated Member', leaderboardName: 'Updated M.', email: 'updated@example.invalid', phoneNumber: profile.phoneNumber, marketingConsent: true };
    assert.equal((await request('/api/account/details', details)).status, 401);
    const verificationToken = await verify(request);
    assert.equal((await request('/api/membership', { ...profile, verificationToken })).status, 200);
    const before = await readStore(), eventCount = events.length;
    assert.equal((await request('/api/account/details', details, other)).status, 401);
    assert.equal((await request('/api/account/details', details, member, { Origin: 'https://example.invalid' })).status, 403);
    for (const change of [{ name: '<script>' }, { leaderboardName: 'Player123' }, { email: 'invalid' }, { phoneNumber: '+919876543211' }, { marketingConsent: null }, { customerId: 'cus_other' }, { savedPoints: 999999 }]) {
      const result = await request('/api/account/details', { ...details, ...change });
      assert.ok([400,409].includes(result.status));
      assert.deepEqual(await readStore(), before, 'rejected edits must not partially persist');
    }
    assert.deepEqual((await request('/api/account/details', details)).data, { success: true });
    const account = (await request('/api/account')).data;
    for (const [key, value] of Object.entries(details)) assert.equal(account[key], value);
    assert.equal(account.savedPoints, 3200); assert.equal(account.bestPoints, 3205);
    const after = await readStore();
    assert.deepEqual(after.games, before.games); assert.deepEqual(after.rewardAccounts, before.rewardAccounts);
    assert.equal(after.players[member].profile.customerId, before.players[member].profile.customerId);
    assert.equal(after.players[member].name, details.leaderboardName);
    assert.equal(after.players[member].profile.termsUrl, before.players[member].profile.termsUrl);
    assert.ok(events.length > eventCount); assert.equal(awards.size, 1); assert.equal(state.profile.email, details.email);
    // Preferences use the same profile write, without another rewards request.
    assert.equal((await request('/api/account/details', { ...details, marketingConsent: false })).status, 200);
    assert.equal((await readStore()).players[member].profile.marketingConsent, undefined); assert.equal(state.profile.marketing_consent,false);
  });
});

test('Medusa profile failures never report a local-only save or award points',async()=>{
  await withRewardsSite(async({request,state,awards,readStore})=>{
    const verificationToken=await verify(request);
    state.profileWriteError={status:409,code:'email_in_use'};
    const failed=await request('/api/membership',{...profile,verificationToken});
    assert.equal(failed.status,409);assert.equal(failed.data.code,'email_in_use');
    assert.equal((await readStore()).players[member].profile,undefined);assert.equal(awards.size,0);
    state.profileWriteError=null;
    assert.equal((await request('/api/membership',{...profile,verificationToken})).status,200);
    const before=await readStore(),centralBefore={...state.profile};
    state.profileWriteError={status:409,code:'email_in_use'};
    assert.equal((await request('/api/account/details',{name:'Another Member',leaderboardName:'Another M.',email:'used@example.invalid',phoneNumber:profile.phoneNumber,marketingConsent:false})).status,409);
    assert.deepEqual(await readStore(),before);assert.deepEqual(state.profile,centralBefore);
    state.expiredToken=true;
    assert.equal((await request('/api/account')).status,401);
    assert.equal((await request('/api/account')).data.code,'rewards_verification_required');
  });
});
