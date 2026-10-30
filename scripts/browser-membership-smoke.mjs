import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { withRewardsSite, member, gameId } from '../tests/helpers/rewards-fixture.mjs';

// Production-built UI + real local Node proxy + a deterministic rewards API fixture.
// No production messages, customers or balances are touched.
const require = createRequire(import.meta.url);
const engine = process.env.SOFACET_BROWSER || 'chromium';
assert.ok(['chromium','webkit'].includes(engine));
const { [engine]: browserType } = require(process.env.SOFACET_PLAYWRIGHT_PATH || 'playwright');
const browser = await browserType.launch();
try {
  for (const returningMember of [false, true]) {
    await withRewardsSite(async ({ origin, request, events, awards }) => {
      const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
      try {
        await context.addCookies([{ name: 'sofacet_pinball_player', value: member, url: origin, httpOnly: true, sameSite: 'Lax' }]);
        const page = await context.newPage(), errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.goto(origin + '/health');
        await page.setContent(`<iframe id="membership" style="width:100%;height:850px;border:0" src="/membership.html?nav=game${returningMember ? '&verify=1' : ''}"></iframe><script>
          addEventListener('message', event => {
            if(event.origin === location.origin && event.data?.type === 'sofacet:membership-ready') event.source.postMessage({type:'sofacet:pending-reward',result:{points:3205,rewardValue:320.5,completedAt:Date.now(),gameId:'${gameId}',status:'completed'}},location.origin);
          });
        </script>`);
        const frame = page.frameLocator('#membership');
        await frame.locator(returningMember ? '#phone' : '#front-name').waitFor({ state: 'visible' });
        if (returningMember) {
          assert.equal(await frame.locator('#front-name').count(), 0);
          await frame.locator('#phone').fill('9876543210');
          assert.equal((await request('/api/membership/rewards', { gameId })).data.code, 'rewards_verification_required');
        } else {
          await frame.locator('#front-name').fill('Test Member');
          await frame.locator('#phone').fill('9876543210');
          await frame.locator('#email').fill('test@example.invalid');
        }
        if (!returningMember) await frame.locator('#terms').check();
        await frame.getByRole('button', { name: 'Save my points', exact: true }).click();
        await frame.locator('#final-otp').waitFor({ state: 'visible' });
        assert.match(await frame.locator('#confirmation-copy').innerText(), /WhatsApp/);
        assert.match(await frame.getByRole('button', { name: /Resend code/ }).innerText(), /0:[56]\d|1:00/);
        await frame.locator('#final-otp').fill('000000');
        await frame.getByRole('button', { name: 'Confirm', exact: true }).click();
        await frame.locator('.confirmation-status').filter({ hasText: 'That code doesn’t match' }).waitFor();
        assert.equal(awards.size, 0);
        await frame.locator('#final-otp').fill('012345');
        await frame.getByRole('button', { name: 'Confirm', exact: true }).click();
        await frame.locator('#success').waitFor({ state: 'visible' });
        assert.match(await frame.locator('#success').innerText(), /3,200 points/);
        assert.deepEqual(events.filter(item => ['/rewards/auth','/rewards/auth/verify'].includes(item.path)).map(item=>item.path), ['/rewards/auth', '/rewards/auth/verify', '/rewards/auth/verify']);
        assert.ok(events.some(item=>item.path==='/rewards/profile'));
        assert.equal(awards.size, 1); assert.deepEqual(errors, []);
        const storage = await frame.locator('body').evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }));
        assert.ok(!storage.includes('fixture-signature') && !storage.includes('fixture-partner-key'));
        console.log(engine + ': ' + (returningMember ? 'returning-member re-verification' : 'save-my-points registration') + ' passed');
        await page.goto(origin + '/account.html');
        await page.getByRole('textbox', { name: 'Name', exact: true }).fill('Updated Member');
        await page.getByRole('textbox', { name: 'Leaderboard name', exact: true }).fill('Updated M.');
        await page.getByRole('textbox', { name: 'Email', exact: true }).fill('updated@example.invalid');
        await page.getByRole('button', { name: 'Save changes', exact: true }).click();
        await page.getByRole('status').filter({ hasText: 'Your details are updated.' }).waitFor();
        await page.reload();
        await page.locator('#account-screen').waitFor();
        assert.equal(await page.getByRole('textbox', { name: 'Name', exact: true }).inputValue(), 'Updated Member');
        assert.equal(await page.getByRole('textbox', { name: 'Email', exact: true }).inputValue(), 'updated@example.invalid');
        assert.match(await page.locator('.score-panel').innerText(), /Saved for launch/);
        assert.equal((await request('/api/account')).data.savedPoints, 3200);
        assert.equal(awards.size, 1); assert.ok(events.some(item=>item.path==='/rewards/profile'&&item.body?.email==='updated@example.invalid'));
        console.log(engine + ': profile edits persisted after reload without new reward credits');
      } finally { await context.close(); }
    }, { returningMember });
  }
} finally { await browser.close(); }
