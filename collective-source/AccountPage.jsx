import React, {useRef, useState} from 'react';
import PageShell from './PageShell.jsx';
import {AccountArtwork, AccountMesh} from './artwork/AccountArtwork.jsx';
import initialize from './scenes/account.js';
import {accountNavigationHref} from '../shared/account-session.js';
import {countries} from '../membership-source/src/phone.js';
import {Arrow} from './icons.jsx';
import {validPhone, validateAccount} from './validation.js';
import {formValues, showValidation, useSubmission} from './form-actions.js';

export default function AccountPage({pointsContext=false,initialTab = 'registered', activeTab, onTabChange, onLogin, onRequestOtp, onCreateAccount, termsUrl, privacyUrl, defaults = {}, status = '', resendSeconds = 0, working = false}) {
  const [selectedTab, setTab] = useState(initialTab);
  const tab = activeTab ?? selectedTab;
  const login = useSubmission(), create = useSubmission();
  const phone = useRef(null);
  const currentYear = new Date().getFullYear();
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
    void login.submit(onRequestOtp, {phone:phone.current.value.trim()}, 'OTP sending is not connected in this preview.');
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
    if (showValidation(form, validateAccount(values), create.setMessage)) return;
    void create.submit(onCreateAccount, {...values, terms:values.terms === 'on', updates:values.updates === 'on'}, 'Account creation is not connected in this preview.');
  }
  const policyLink = (label,url) => <a href={url || (label==='Privacy Policy'?'/privacy.html':'/terms.html')}>{label}</a>;
  return <PageShell scene="account" initialize={initialize} title="Welcome Back | SO/FACET">
    <AccountMesh />
    <main className="shell"><div className="container">
      {pointsContext&&<p className="points-label">MY POINTS</p>}
      <h1 className="welcome-heading">WELCOME BACK</h1>
      <nav aria-label="Account access" className="tabs" role="tablist">
        <button aria-controls="registered-panel" aria-selected={tab === 'registered'} className={'tab' + (tab === 'registered' ? ' active' : '')} id="registered-tab" role="tab" type="button" tabIndex={tab === 'registered' ? 0 : -1} onClick={() => selectTab('registered')} onKeyDown={tabKey}>ALREADY REGISTERED?</button>
        <button aria-controls="create-panel" aria-selected={tab === 'create'} className={'tab' + (tab === 'create' ? ' active' : '')} id="create-tab" role="tab" type="button" tabIndex={tab === 'create' ? 0 : -1} onClick={() => selectTab('create')} onKeyDown={tabKey}>CREATE YOUR ACCOUNT</button>
      </nav>
      <section aria-labelledby="registered-tab" className="panel login-panel" id="registered-panel" role="tabpanel" hidden={tab !== 'registered'}>
        <p className="intro stagger">If you are already registered with <span className="wm">SO/ FACET</span>, login here:</p>
        {pointsContext&&<a className="points-play" href={accountNavigationHref('/play.html')}>New here? Play Pinball to earn points →</a>}
        <form id="login-form" noValidate onSubmit={signIn}>
          <div className="field-group stagger"><label className="field-title" htmlFor="login-phone">Mobile number</label><input ref={phone} autoComplete="tel-national" className="text-line" id="login-phone" inputMode="tel" name="phone" pattern="[+0-9 ()-]{7,22}" defaultValue={defaults.phone || ''} required type="tel" /></div>
          <div className="field-group stagger"><label className="field-title" htmlFor="login-otp">OTP</label><div className="otp-grid"><input autoComplete="one-time-code" className="text-line" id="login-otp" inputMode="numeric" maxLength={6} name="otp" pattern="[0-9]{6}" required type="text" /><button className="small-button" id="generate" type="button" onClick={requestCode} disabled={login.busy || working || resendSeconds > 0}>GENERATE OTP</button></div></div>
          <div className="stagger"><button className="under-link" id="resend" type="button" onClick={requestCode} disabled={login.busy || working || resendSeconds > 0}>{resendSeconds > 0 ? 'Resend OTP in ' + resendSeconds + 's' : 'Resend OTP'}</button><p className="privacy-text">Read the {policyLink('Privacy Policy',privacyUrl)} for further information</p><button className="cta" type="submit" disabled={login.busy || working}>{login.busy || working ? 'PLEASE WAIT…' : 'LOGIN'} <Arrow /></button><p aria-live="polite" className="feedback" id="login-feedback" role="status">{status || login.message}</p></div>
        </form>
        {pointsContext&&<div className="points-notes"><p>No password to remember.</p><p>Your best score stays yours.</p><a href={accountNavigationHref('/faq.html')}>How points work</a></div>}
      </section>
      <section aria-labelledby="create-tab" className="panel create-panel" hidden={tab !== 'create'} id="create-panel" role="tabpanel">
        <form id="create-form" noValidate onSubmit={createAccount}>
          <fieldset className="titles" style={{border:0,padding:0}}><legend className="field-title">Title</legend><div className="radio-row">{['Mr','Mrs','Ms'].map(title => <label className="radio-label" key={title}><input name="title" required type="radio" value={title} defaultChecked={defaults.title === title} />{title}</label>)}</div></fieldset>
          <div className="field-group"><label className="field-title" htmlFor="new-name">Name</label><input autoComplete="name" className="text-line" id="new-name" name="name" defaultValue={defaults.name || ''} required /></div>
          <div className="split-fields">
            <div className="field-group"><label className="field-title" htmlFor="day">Date of birth</label><div className="dob-row">
              <select aria-label="Birth day" className="select" id="day" name="day" required defaultValue={defaults.day || ''}><option value="">Day</option>{Array.from({length:31},(_,i) => <option value={i+1} key={i}>{String(i+1).padStart(2,'0')}</option>)}</select>
              <select aria-label="Birth month" className="select" id="month" name="month" required defaultValue={defaults.month || ''}><option value="">Month</option>{Array.from({length:12},(_,i) => <option value={i+1} key={i}>{String(i+1).padStart(2,'0')}</option>)}</select>
              <select aria-label="Birth year" className="select" id="year" name="year" required defaultValue={defaults.year || ''}><option value="">Year</option>{Array.from({length:currentYear-1899},(_,i) => <option value={currentYear-i} key={i}>{currentYear-i}</option>)}</select>
            </div></div>
            <div className="field-group"><label className="field-title" htmlFor="new-city">City</label><input autoComplete="address-level2" className="text-line" id="new-city" name="city" defaultValue={defaults.city || ''} required /></div>
          </div>
          <div className="field-group"><label className="field-title" htmlFor="new-phone">Mobile number</label><div className="phone-line"><select aria-label="Country code" className="select country-select" name="country" defaultValue={defaults.country || '+91'}>{countries.map(country => <option key={country.code} value={country.dial}>{country.name} ({country.dial})</option>)}</select><input autoComplete="tel-national" className="text-line" id="new-phone" inputMode="tel" name="phone" pattern="[0-9]{7,15}" placeholder="Phone" defaultValue={defaults.phone || ''} required type="tel" /></div></div>
          <div className="field-group"><label className="field-title" htmlFor="new-email">Email address</label><input autoComplete="email" className="text-line" id="new-email" name="email" defaultValue={defaults.email || ''} required type="email" /></div>
          <div className="checkboxes"><label className="checkbox-row"><input name="terms" required type="checkbox" defaultChecked={!!defaults.terms} /><span>I'm 18 or older and I agree to the {policyLink('Terms and Conditions',termsUrl)} and {policyLink('Privacy Policy',privacyUrl)}.</span></label><label className="checkbox-row"><input name="updates" type="checkbox" defaultChecked={!!defaults.updates} /><span>Send me <span className="wm">SO/ FACET</span> news and launch updates.</span></label></div>
          <button className="cta" type="submit" disabled={create.busy || working}>{create.busy || working ? 'PLEASE WAIT…' : 'CREATE ACCOUNT'} <Arrow /></button><p aria-live="polite" className="feedback" id="create-feedback" role="status">{status || create.message}</p>
        </form>
      </section>
    </div></main>
    <AccountArtwork />
  </PageShell>;
}
