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
        await frame.locator('#front-name').waitFor({ state: 'visible' });
        if (returningMember) {
          assert.equal(await frame.locator('#front-name').inputValue(), 'Test Member');
          assert.equal(await frame.locator('#email').inputValue(), 'test@example.invalid');
          assert.equal((await request('/api/membership/rewards', { gameId })).data.code, 'rewards_verification_required');
        } else {
          await frame.locator('#front-name').fill('Test Member');
          await frame.locator('#phone').fill('9876543210');
          await frame.locator('#email').fill('test@example.invalid');
        }
        await frame.locator('#terms').check();
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
        assert.deepEqual(events.map(item => item.path), ['/rewards/auth', '/rewards/auth/verify', '/rewards/auth/verify', '/rewards/score', '/rewards/points']);
        assert.equal(awards.size, 1); assert.deepEqual(errors, []);
        const storage = await frame.locator('body').evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }));
        assert.ok(!storage.includes('fixture-signature') && !storage.includes('fixture-partner-key'));
        console.log(engine + ': ' + (returningMember ? 'returning-member re-verification' : 'save-my-points registration') + ' passed');
      } finally { await context.close(); }
    }, { returningMember });
  }
} finally { await browser.close(); }
