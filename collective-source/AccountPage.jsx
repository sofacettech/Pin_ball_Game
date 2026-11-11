import React, {useRef, useState} from 'react';
import PageShell from './PageShell.jsx';
import {AccountArtwork, AccountMesh} from './artwork/AccountArtwork.jsx';
import initialize from './scenes/account.js';
import {accountNavigationHref} from '../shared/account-session.js';
import {countries} from '../membership-source/src/phone.js';
import {Arrow} from './icons.jsx';
import {validPhone, validateAccount} from './validation.js';
import {formValues, showValidation, useSubmission} from './form-actions.js';

export default function AccountPage({pageTitle='SO/ FACET — My SO/ COINS',pointsContext=false,updatesRequired=true,initialTab = 'registered', activeTab, onTabChange, onLogin, onRequestOtp, onCreateAccount, termsUrl, privacyUrl, defaults = {}, status = '', resendSeconds = 0, working = false}) {
  const [selectedTab, setTab] = useState(initialTab);
  const tab = activeTab ?? selectedTab;
  const login = useSubmission(), create = useSubmission();
  const phone = useRef(null);
  function selectTab(name, focus = false) {
    if (working) return;
    setTab(name);
    onTabChange?.(name);
    if (focus) document.getElementById(name + '-tab')?.focus();
  }
  function tabKey(event) {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault(); selectTab(tab === 'registered' ? 'create' : 'registered', true);
  }
  function requestCode() {
    if (resendSeconds > 0 || working) return;
    if (!validPhone(phone.current.value, 10)) {login.setMessage('Enter a valid mobile number first.'); phone.current.focus(); return;}
    void login.submit(onRequestOtp, {phone:phone.current.value.trim()}, 'Code sending is not connected in this preview.');
  }
  function signIn(event) {
    event.preventDefault();
    const form = event.currentTarget;
    if (!form.reportValidity()) return;
    void login.submit(onLogin, formValues(form), 'Login verification is not connected in this preview.');
  }
  function createAccount(event) {
    event.preventDefault();
    const form = event.currentTarget, values = formValues(form);
    if (!form.reportValidity()) return;
    if (showValidation(form, validateAccount(values), create.setMessage)) return;
    void create.submit(onCreateAccount, {...values, terms:values.terms === 'on', updates:values.updates === 'on'}, 'Account creation is not connected in this preview.');
  }
  const policyLink = (label,url) => <a href={url || (label==='Privacy Policy'?'/privacy':'/terms')} target="_blank" rel="noopener">{label}</a>;
  return <PageShell scene="account" initialize={initialize} title={pageTitle}>
    <AccountMesh />
    <main className="shell"><div className="container">
      {pointsContext&&<p className="points-label">MY SO/ COINS</p>}
      <h1 className="welcome-heading">WELCOME</h1>
      <nav aria-label="Account access" className="tabs" role="tablist">
        <button aria-controls="registered-panel" aria-selected={tab === 'registered'} className={'tab' + (tab === 'registered' ? ' active' : '')} id="registered-tab" role="tab" type="button" tabIndex={tab === 'registered' ? 0 : -1} onClick={() => selectTab('registered')} onKeyDown={tabKey}>SIGN IN</button>
        <button aria-controls="create-panel" aria-selected={tab === 'create'} className={'tab' + (tab === 'create' ? ' active' : '')} id="create-tab" role="tab" type="button" tabIndex={tab === 'create' ? 0 : -1} onClick={() => selectTab('create')} onKeyDown={tabKey}>JOIN THE SO/ COLLECTIVE</button>
      </nav>
      <section aria-labelledby="registered-tab" className="panel login-panel" id="registered-panel" role="tabpanel" hidden={tab !== 'registered'}>
        <p className="intro stagger">Sign in with the mobile number you saved your SO/ COINS with.</p>
        {pointsContext&&<a className="points-play" href={accountNavigationHref('/game')}>New here? Play pinball to earn SO/ COINS →</a>}
        <form id="login-form" noValidate onSubmit={signIn}>
          <div className="field-group stagger"><label className="field-title" htmlFor="login-phone">Mobile number</label><input ref={phone} autoComplete="tel-national" className="text-line" id="login-phone" inputMode="tel" name="phone" pattern="[+0-9 ()-]{7,22}" defaultValue={defaults.phone || ''} required type="tel" /></div>
          <div className="field-group stagger"><label className="field-title" htmlFor="login-otp">Code</label><div className="otp-grid"><input autoComplete="one-time-code" className="text-line" id="login-otp" inputMode="numeric" maxLength={6} name="otp" pattern="[0-9]{6}" required type="text" /><button className="small-button" id="generate" type="button" onClick={requestCode} disabled={login.busy || working || resendSeconds > 0}>SEND CODE</button></div></div>
          <div className="stagger"><button className="under-link" id="resend" type="button" onClick={requestCode} disabled={login.busy || working || resendSeconds > 0}>{resendSeconds > 0 ? 'Resend code in ' + resendSeconds + 's' : 'Resend code'}</button><p className="privacy-text">How we use your details: {policyLink('Privacy Policy',privacyUrl)}</p><button className="cta" type="submit" disabled={login.busy || working}>{login.busy || working ? 'PLEASE WAIT…' : 'SIGN IN'} <Arrow /></button><p aria-live="polite" className="feedback" id="login-feedback" role="status">{status || login.message}</p></div>
        </form>
        {pointsContext&&<div className="points-notes"><p>No password to remember.</p><p>Your best score stays yours.</p><a href={accountNavigationHref('/how-coins-work')}>HOW SO/ COINS WORK</a></div>}
      </section>
      <section aria-labelledby="create-tab" className="panel create-panel" hidden={tab !== 'create'} id="create-panel" role="tabpanel">
        <form id="create-form" noValidate onSubmit={createAccount}>
          <div className="field-group"><label className="field-title" htmlFor="new-name">Full name</label><input autoComplete="name" className="text-line" id="new-name" name="name" defaultValue={defaults.name || ''} required /></div>
          <div className="field-group"><label className="field-title" htmlFor="new-phone">Mobile number</label><div className="phone-line"><select aria-label="Country code" className="select country-select" name="country" defaultValue={defaults.country || '+91'}>{countries.map(country => <option key={country.code} value={country.dial}>{country.name} ({country.dial})</option>)}</select><input autoComplete="tel-national" className="text-line" id="new-phone" inputMode="tel" name="phone" pattern="[0-9]{7,15}" placeholder="Phone" defaultValue={defaults.phone || ''} required type="tel" /></div></div>
          <div className="field-group"><label className="field-title" htmlFor="new-email">Email address</label><input autoComplete="email" className="text-line" id="new-email" name="email" defaultValue={defaults.email || ''} required type="email" /></div>
          <div className="checkboxes"><label className="checkbox-row"><input name="terms" required type="checkbox" defaultChecked={!!defaults.terms} /><span>I'm 18 or older and I agree to the {policyLink('Terms and Conditions',termsUrl)} and {policyLink('Privacy Policy',privacyUrl)}.</span></label><label className="checkbox-row"><input name="updates" required={updatesRequired} type="checkbox" defaultChecked={!!defaults.updates} /><span>Keep me posted on new collections, drops and what's next.</span></label></div>
          <button className="cta" type="submit" disabled={create.busy || working}>{create.busy || working ? 'PLEASE WAIT…' : 'JOIN THE SO/ COLLECTIVE'} <Arrow /></button><p aria-live="polite" className="feedback" id="create-feedback" role="status">{status || create.message}</p>
        </form>
      </section>
    </div></main>
    <AccountArtwork />
  </PageShell>;
}
