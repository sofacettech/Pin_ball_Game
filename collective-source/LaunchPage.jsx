import React, {useEffect, useRef, useState} from 'react';
import PageShell from './PageShell.jsx';
import {LaunchArtwork, LaunchMesh} from './artwork/LaunchArtwork.jsx';
import initialize from './scenes/launch.js';
import {useSubmission} from './form-actions.js';
import {accountNavigationHref} from '../shared/account-session.js';

function JoinDialog({open, onClose, onJoin}) {
  const dialog = useRef(null);
  const {message, setMessage, busy, submit} = useSubmission();
  useEffect(() => {
    if (open && !dialog.current.open) {setMessage(''); dialog.current.showModal();}
    if (!open && dialog.current.open) dialog.current.close();
  }, [open, setMessage]);
  function join(event) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    void submit(onJoin,{fullName:values.get('fullName').trim(),phoneNumber:values.get('phoneNumber').trim(),email:values.get('email').trim(),adultPrivacyAccepted:values.get('adultPrivacyAccepted')==='on',marketingConsent:values.get('marketingConsent')==='on'},'Signup is unavailable. Please try again later.');
  }
  function backdrop(event) {
    if (event.target !== dialog.current) return;
    const box = dialog.current.getBoundingClientRect();
    if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) onClose();
  }
  return <dialog ref={dialog} aria-labelledby="join-title" id="join" onClose={onClose} onClick={backdrop}>
    <button aria-label="Close signup" className="icon-button dialog-close" type="button" onClick={onClose}><svg aria-hidden="true" viewBox="0 0 24 24"><path d="m4 4 16 16M20 4 4 20" /></svg></button>
    <h2 id="join-title">JOIN SO/ COLLECTIVE</h2>
    <form id="join-form" onSubmit={join}>
      <label className="field-label" htmlFor="join-name">Full name</label><input autoComplete="name" id="join-name" name="fullName" maxLength={80} required disabled={busy}/>
      <label className="field-label" htmlFor="join-phone">Mobile number</label><input autoComplete="tel" id="join-phone" name="phoneNumber" type="tel" inputMode="tel" maxLength={30} required disabled={busy}/>
      <label className="field-label" htmlFor="email">Email</label><input autoComplete="email" id="email" name="email" required type="email" maxLength={254} disabled={busy}/>
      <label className="join-consent"><input id="join-privacy" name="adultPrivacyAccepted" type="checkbox" required disabled={busy}/><span>I'm 18 or older and I agree to the <a href="/privacy.html" target="_blank" rel="noopener noreferrer">Privacy Policy</a>.</span></label>
      <label className="join-consent"><input id="join-updates" name="marketingConsent" type="checkbox" required disabled={busy}/><span>Send me <span className="brand-word">SO/ FACET</span> updates and early access.</span></label>
      <button className="dialog-action" type="submit" disabled={busy}>{busy?'Please wait…':'JOIN SO/ COLLECTIVE'}</button><p aria-live="polite" className="status" id="join-status" role="status">{message}</p>
    </form>
  </dialog>;
}

export default function LaunchPage({onJoin, onPlay}) {
  const [joinOpen, setJoinOpen] = useState(()=>location.hash==='#join');
  useEffect(()=>{const update=()=>setJoinOpen(location.hash==='#join');window.addEventListener('hashchange',update);return()=>window.removeEventListener('hashchange',update)},[]);
  function closeJoin(){setJoinOpen(false);if(location.hash==='#join')history.replaceState(null,'',location.pathname+location.search);}
  return <PageShell scene="launch" initialize={initialize} title="SO/ FACET — What's yours?">
    <LaunchMesh /><LaunchArtwork />
    <main className="page text-layer launch-scope" id="home"><section className="reward" aria-label="Launching soon"><div className="copy">
      <p className="eyebrow brand"><span>LAUNCHING SOON</span></p>
      <h1><span>Your diamond</span><em>is being cut.</em></h1>
      <p className="description">Lab-grown diamond jewellery, in shapes that mean something.<br /> JOIN SO/ COLLECTIVE for updates and early access, before anyone else.</p>
      <div className="action-group">
        <button className="join-button" type="button" onClick={() => window.top.location.assign(accountNavigationHref('/membership.html?from=collective'))}><span>JOIN SO/ COLLECTIVE</span><svg aria-hidden="true" viewBox="0 0 28 28"><path d="M3 14h21m-8-8 8 8-8 8" /></svg></button>
        <button className="pinball-link" type="button" disabled={!onPlay} title={onPlay ? 'Play Pinball' : 'Pinball page coming soon'} onClick={onPlay}><span>Rather play first? Play Pinball</span><svg aria-hidden="true" viewBox="0 0 28 28"><path d="M2 14h23m-8-8 8 8-8 8" /></svg></button>
      </div>
    </div></section></main>
    <div className="launch-scope"><JoinDialog open={joinOpen} onClose={closeJoin} onJoin={onJoin} /></div>
  </PageShell>;
}
