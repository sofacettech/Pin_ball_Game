import React, {useEffect, useRef, useState} from 'react';
import PageShell from './PageShell.jsx';
import {LaunchArtwork, LaunchMesh} from './artwork/LaunchArtwork.jsx';
import initialize from './scenes/launch.js';
import {useSubmission} from './form-actions.js';

function JoinDialog({open, onClose, onJoin}) {
  const dialog = useRef(null);
  const {message, setMessage, busy, submit} = useSubmission();
  useEffect(() => {
    if (open && !dialog.current.open) {setMessage(''); dialog.current.showModal();}
    if (!open && dialog.current.open) dialog.current.close();
  }, [open, setMessage]);
  function join(event) {
    event.preventDefault();
    const email = new FormData(event.currentTarget).get('email').trim();
    if (onJoin) {void submit(onJoin, {email}, ''); return;}
    try {localStorage.setItem('sofacet-interest',email); setMessage('Saved on this device. You have not been subscribed to emails.');}
    catch {setMessage('Your browser could not save this email. Please allow local storage and try again.');}
  }
  function backdrop(event) {
    if (event.target !== dialog.current) return;
    const box = dialog.current.getBoundingClientRect();
    if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) onClose();
  }
  return <dialog ref={dialog} aria-labelledby="join-title" id="join" onClose={onClose} onClick={backdrop}>
    <button aria-label="Close signup" className="icon-button dialog-close" type="button" onClick={onClose}><svg aria-hidden="true" viewBox="0 0 24 24"><path d="m4 4 16 16M20 4 4 20" /></svg></button>
    <p className="dialog-label">The first cut</p><h2 id="join-title">Be part of the beginning.</h2>
    <p>Updates and early access to <span className="brand-inline">SO/ FACET</span>.</p>
    <p className="preview-note">{onJoin?'Continue to create your account and verify your number.':'Standalone preview: your email is saved only on this device. This does not subscribe you to emails.'}</p>
    <form id="join-form" onSubmit={join}><label className="field-label" htmlFor="email">Email address</label><input autoComplete="email" id="email" name="email" placeholder="you@example.com" required type="email" /><button className="dialog-action" type="submit" disabled={busy}>{busy ? 'Please wait…' : onJoin ? 'Continue' : 'Save my interest'}</button><p aria-live="polite" className="status" id="join-status" role="status">{message}</p></form>
  </dialog>;
}

export default function LaunchPage({onJoin, onPlay}) {
  const [joinOpen, setJoinOpen] = useState(false);
  return <PageShell scene="launch" initialize={initialize} title="SO/FACET — Launching Soon">
    <LaunchMesh /><LaunchArtwork />
    <main className="page text-layer launch-scope" id="home"><section className="reward" aria-label="Launching soon"><div className="copy">
      <p className="eyebrow brand"><span>LAUNCHING SOON</span></p>
      <h1><span>Your diamond</span><em>is being cut.</em></h1>
      <p className="description">Lab-grown diamond jewellery, in shapes that mean something.<br /> Join “THE FIRST CUT” for updates and early access.</p>
      <div className="action-group">
        <button className="join-button" type="button" onClick={() => setJoinOpen(true)}><span>JOIN THE FIRST CUT</span><svg aria-hidden="true" viewBox="0 0 28 28"><path d="M3 14h21m-8-8 8 8-8 8" /></svg></button>
        <button className="pinball-link" type="button" disabled={!onPlay} title={onPlay ? 'Play Pinball' : 'Pinball page coming soon'} onClick={onPlay}><span>Rather play first? Play Pinball</span><svg aria-hidden="true" viewBox="0 0 28 28"><path d="M2 14h23m-8-8 8 8-8 8" /></svg></button>
      </div>
    </div></section></main>
    <div className="launch-scope"><JoinDialog open={joinOpen} onClose={() => setJoinOpen(false)} onJoin={onJoin} /></div>
  </PageShell>;
}
