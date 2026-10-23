import React,{useEffect,useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {request,normalisePhone} from '../../membership-source/src/api.js';
import {brandText} from '../../shared/brand-react.jsx';
import './style.css';
const number=new Intl.NumberFormat('en-IN');
const money=points=>'₹'+number.format(points/10);
function App(){
 const [stage,setStage]=useState('loading'),[account,setAccount]=useState(null),[phone,setPhone]=useState(''),[code,setCode]=useState('');
 const [challenge,setChallenge]=useState(null),[resendAt,setResendAt]=useState(0),[seconds,setSeconds]=useState(0);
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[modal,setModal]=useState(null),[notice,setNotice]=useState('');
 const [editName,setEditName]=useState(''),[editPhone,setEditPhone]=useState('');
 const dialog=useRef(null),opener=useRef(null),controller=useRef(null),locked=useRef(false),mounted=useRef(true);
 const load=async signal=>{
  const player=await request('/api/player',undefined,signal);
  if(signal?.aborted||!mounted.current)return;
  if(player.member!==true){setAccount(null);setStage('signin');return}
  const result=await request('/api/account',undefined,signal);
  if(signal?.aborted||!mounted.current)return;
  if(typeof result.name!=='string'||typeof result.phoneNumber!=='string'||![result.savedPoints,result.bestPoints].every(v=>Number.isSafeInteger(v)&&v>=0)||typeof result.marketingConsent!=='boolean')throw Error('Your account could not be confirmed. Please try again.');
  setAccount(result);setStage(result.savedPoints>0?'points':'empty');
  return result;
 };
 async function run(action){
  if(locked.current)return;
  locked.current=true;setBusy(true);setError('');controller.current?.abort();controller.current=new AbortController();
  try{await action(controller.current.signal)}catch(error){if(mounted.current&&!controller.current.signal.aborted)setError(error.message||'Please try again.')}
  finally{locked.current=false;if(mounted.current)setBusy(false)}
 }
 useEffect(()=>{
  mounted.current=true;const abort=new AbortController();controller.current=abort;
  load(abort.signal).catch(error=>{if(!abort.signal.aborted){setError(error.message);setStage('error')}});
  return()=>{mounted.current=false;controller.current?.abort()};
 },[]);
 useEffect(()=>{const tick=()=>setSeconds(Math.max(0,Math.ceil((resendAt-Date.now())/1000)));tick();if(!resendAt)return;const timer=setInterval(tick,1000);return()=>clearInterval(timer)},[resendAt]);
 useEffect(()=>{document.querySelector('#account-root h1')?.focus({preventScroll:true})},[stage]);
 useEffect(()=>{if(modal){dialog.current.showModal();return()=>{dialog.current?.close();opener.current?.focus({preventScroll:true})}}},[modal]);
 useEffect(()=>{if(!notice)return;const timer=setTimeout(()=>setNotice(''),5000);return()=>clearTimeout(timer)},[notice]);
 function open(type){opener.current=document.activeElement;setError('');if(type==='edit'){setEditName(account.name);setEditPhone(account.phoneNumber.replace(/^\+91/,''))}setModal(type)}
 function close(){if(!busy){setModal(null);setError('')}}
 const phoneNumber=normalisePhone(phone);
 async function send(event){
  event?.preventDefault();
  if(!phoneNumber){setError('Enter a valid 10-digit phone number.');document.getElementById('phone').focus();return}
  await run(async signal=>{
   const result=await request('/api/account/otp/request',{phoneNumber},signal);
   if(result.success!==true||typeof result.challengeId!=='string'||!result.challengeId||!Number.isFinite(result.expiresIn)||result.expiresIn<=0)throw Error('The code request could not be confirmed. Please try again.');
   setChallenge({id:result.challengeId,expiresAt:Date.now()+result.expiresIn*1000});setResendAt(Date.now()+Math.max(30,Number(result.resendAfter)||30)*1000);setCode('');setStage('code');
   requestAnimationFrame(()=>document.getElementById('code')?.focus());
  });
 }
 async function verify(event){
  event.preventDefault();if(!/^\d{6}$/.test(code)){setError('Enter the full 6-digit code.');return}
  if(!challenge||Date.now()>=challenge.expiresAt){setError('This code has expired. Please request a new one.');return}
  await run(async signal=>{
   const result=await request('/api/account/otp/verify',{phoneNumber,otp:code,challengeId:challenge.id},signal);
   if(result.verified!==true)throw Error('The code could not be verified.');
   const confirmed=await load(signal);if(!confirmed){setStage('code');throw Error('Your sign-in could not be confirmed. Please try again.')}
   setCode('');setChallenge(null);
  });
 }
 function signOut(){void run(async signal=>{const result=await request('/api/account/signout',{},signal);if(result.success!==true)throw Error('Sign-out could not be confirmed.');setAccount(null);setPhone('');setCode('');setChallenge(null);setModal(null);setStage('signin');setNotice('Signed out.')})}
 async function saveDetails(event){
  event.preventDefault();const normalized=normalisePhone(editPhone);
  if(!editName.trim()||editName.trim().length>40||!normalized){setError('Enter your name and a valid 10-digit phone number.');return}
  await run(async signal=>{
   const result=await request('/api/account/details',{name:editName.trim(),phoneNumber:normalized},signal);if(result.success!==true)throw Error('Your changes have not been confirmed.');
   const confirmed=await load(signal);if(!confirmed||confirmed.name!==editName.trim()||confirmed.phoneNumber!==normalized)throw Error('Your updated details could not be confirmed. A changed number must be verified first.');
   setModal(null);setNotice('Your details are updated.');
  });
 }
 function changeUpdates(){void run(async signal=>{
  const wanted=!account.marketingConsent,result=await request('/api/account/preferences',{marketingConsent:wanted},signal);if(result.success!==true)throw Error('Your preference has not been saved.');
  const confirmed=await load(signal);if(!confirmed||confirmed.marketingConsent!==wanted)throw Error('Your updated preference could not be confirmed.');
  setModal(null);setNotice(wanted?'Updates resumed.':'Updates stopped.');
 })}
 function deleteData(){void run(async signal=>{
  const result=await request('/api/account/delete',{confirm:true},signal);if(result.success!==true)throw Error('Your data has not been deleted.');
  setAccount(null);setPhone('');setCode('');setChallenge(null);setModal(null);setStage('signin');setNotice('Your account deletion is confirmed.');
 })}
 const shareText=account?'I scored '+number.format(account.bestPoints)+' pts on So/Facet pinball.\nWhat’s yours?\n'+location.origin+'/':'';
 async function copy(){try{await navigator.clipboard.writeText(shareText);setNotice('Your score was copied.')}catch{setNotice('Automatic copy is unavailable. Select and copy the score text below.')}}
 const errors=<p className="error" id="account-error" role="alert">{error}</p>;
 const accountLinks=<div className="account-links"><button className="text-button" type="button" onClick={()=>open('edit')}>Edit details</button><button className="text-button" type="button" onClick={()=>open('updates')}>{account?.marketingConsent?'Stop updates':'Resume updates'}</button><button className="text-button" type="button" onClick={()=>open('delete')}>Delete my data</button><button className="text-button" type="button" onClick={signOut} disabled={busy}>Sign out</button></div>;
 return brandText(<>
  <a className="skip" href="#main">Skip to content</a>
  <main className="shell" id="main" tabIndex={-1}>
   {stage==='loading'?<section className="screen loading-panel" aria-live="polite"><div className="loader" aria-hidden="true"/><p>Finding what's yours…</p></section>:null}
   {stage==='signin'||stage==='code'?<section className="screen" aria-labelledby="signin-title"><div className="sign-in-grid"><div className={'intro '+(stage==='code'?'code-intro':'')}><p className="eyebrow">MY POINTS</p><h1 id="signin-title" tabIndex={-1}>{stage==='code'?<>One code. <em>You're back.</em></>:<>Welcome <em>back.</em></>}</h1><p className="supporting">{stage==='code'?'Your points are one step away.':"Enter your phone number and we'll text you a code."}</p></div><div>
    {stage==='code'?<button className="text-button back" type="button" disabled={busy} onClick={()=>{setStage('signin');setChallenge(null);setCode('');setError('')}}><svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="m8 4-6 6 6 6M2 10h16" stroke="currentColor" strokeWidth="1.3"/></svg>Change number</button>:null}
    <form className="form-frame" onSubmit={stage==='code'?verify:send} noValidate aria-busy={busy}>
     <div className="form-top"><h2 className="form-title">{stage==='code'?'CHECK YOUR PHONE':'SIGN IN'}</h2><span className="step-count" aria-label={'Step '+(stage==='code'?2:1)+' of 2'}>{stage==='code'?'02':'01'} / 02</span></div><div className="steps" aria-hidden="true"><i className="current"/><i className={stage==='code'?'current':''}/></div>
     {stage==='signin'?<><label htmlFor="phone">Phone number</label><div className="phone-field"><span className="prefix">+91</span><input id="phone" name="phone" type="tel" autoComplete="tel-national" inputMode="numeric" maxLength={16} placeholder="Your 10-digit number" aria-describedby="phone-help account-error" aria-invalid={!!error&&!phoneNumber} required value={phone} disabled={busy} onChange={e=>{setPhone(e.target.value);setError('')}}/></div><p className="field-help" id="phone-help">Use the number you saved your points with.</p></>:<><p className="code-help">Enter the 6-digit code for<br/><strong>{phoneNumber}</strong>.</p><label htmlFor="code">6-digit code</label><input className="otp-input" id="code" name="code" type="text" inputMode="numeric" autoComplete="one-time-code" maxLength={6} pattern="[0-9]{6}" placeholder="000000" required aria-describedby="account-error" aria-invalid={!!error&&!/^\d{6}$/.test(code)} value={code} disabled={busy} onChange={e=>{setCode(e.target.value.replace(/\D/g,'').slice(0,6));setError('')}}/></>}
     {errors}<button className="primary" type="submit" disabled={busy}>{busy?(stage==='code'?'Signing in…':'Sending…'):stage==='code'?'Sign in':'Send code'}</button>
     {stage==='signin'?<p className="form-foot">No password to remember.</p>:<div className="resend-row"><span>Didn't get a code?</span><button className="text-button" type="button" disabled={busy||seconds>0} onClick={()=>void send()}>{seconds>0?'Resend in '+seconds+'s':'Resend code'}</button></div>}
    </form>{stage==='signin'?<div className="under-form"><span>Your best score stays yours.</span><button className="text-button" type="button" onClick={()=>open('points')}>How points work</button></div>:null}
   </div></div></section>:null}
   {stage==='points'&&account?<section className="screen dashboard" aria-labelledby="points-title"><p className="eyebrow">MY POINTS</p><h1 id="points-title" tabIndex={-1}>{account.name},<br/><em>here's what's yours.</em></h1><div className="points-layout"><div className="score-sheet"><p className="score-caption">Saved points</p><p className="score-number"><span>{number.format(account.savedPoints)}</span><small>pts</small></p><p className="value-line">Worth <strong>{money(account.savedPoints)}</strong> off your So/Facet purchases.</p></div><div><p className="status-line"><svg className="checkmark" viewBox="0 0 18 18" fill="none" aria-hidden="true"><path d="m3 9 4 4 8-8" stroke="#dbfa79" strokeWidth="1.5"/></svg><span>Saved. Redeemable when the doors open.</span></p><p className="rank-line">Leaderboard rank: <strong><a href="/play.html#leaderboard">{account.rank?'#'+number.format(account.rank):'Not ranked yet'}</a></strong></p><div className="dashboard-actions"><a className="primary" href="/play.html">Play again</a><button className="secondary" type="button" onClick={()=>open('share')}>Share my score</button></div><p className="best-note">Best score: {number.format(account.bestPoints)} pts. Only your best score counts.</p></div></div>{!modal?errors:null}{accountLinks}</section>:null}
   {stage==='empty'&&account?<section className="screen dashboard empty-state"><p className="eyebrow">MY POINTS</p><h1 tabIndex={-1}>Your next round.<br/><em>Your first points.</em></h1><p className="supporting">No points saved on this number yet. Play a round and keep what you win.</p><a className="primary" href="/play.html">Play now</a>{!modal?errors:null}{accountLinks}</section>:null}
   {stage==='error'?<section className="screen dashboard empty-state"><p className="eyebrow">MY POINTS</p><h1 tabIndex={-1}>A little pause.<br/><em>Then back to you.</em></h1><p className="supporting">We couldn't load your points. Please try again.</p>{errors}<button className="primary" disabled={busy} onClick={()=>void run(signal=>load(signal))}>Try again</button></section>:null}
  </main>
  {modal?<dialog ref={dialog} aria-labelledby="account-dialog-title" onCancel={e=>{e.preventDefault();close()}} onClick={e=>{if(e.target===e.currentTarget){const r=e.currentTarget.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)close()}}}>
   <button className="close" type="button" disabled={busy} onClick={close} aria-label="Close dialog">×</button>
   <h2 id="account-dialog-title">{({points:'Your best score counts.',edit:'Your details.',updates:account?.marketingConsent?'Stop updates?':'Resume updates?',delete:'Delete my data?',share:'Make it yours.'})[modal]}</h2>
   {modal==='points'?<><p>10 points = ₹1 off your So/Facet purchases. Only your best score counts. Saved points are redeemable when the doors open.</p><button className="primary" onClick={close}>Got it</button></>:null}
   {modal==='edit'?<><p>Keep your name and number up to date.</p><form onSubmit={saveDetails} noValidate><label htmlFor="edit-name">Name</label><input id="edit-name" autoComplete="name" maxLength={40} required disabled={busy} value={editName} onChange={e=>setEditName(e.target.value)}/><label htmlFor="edit-phone">Phone number (+91)</label><input id="edit-phone" type="tel" inputMode="numeric" autoComplete="tel-national" maxLength={16} required disabled={busy} value={editPhone} onChange={e=>setEditPhone(e.target.value)}/>{errors}<div className="dialog-actions"><button className="primary" disabled={busy} type="submit">Save details</button><button className="text-button" disabled={busy} type="button" onClick={close}>Cancel</button></div><p className="dialog-note">A changed phone number must be verified before it can be saved.</p></form></>:null}
   {modal==='updates'?<><p>{account.marketingConsent?'You can keep your points and stop receiving launch updates.':'Hear first when the So/Facet doors open.'}</p>{errors}<div className="dialog-actions"><button className="primary" disabled={busy} onClick={changeUpdates}>{account.marketingConsent?'Stop updates':'Resume updates'}</button><button className="text-button" disabled={busy} onClick={close}>Cancel</button></div></>:null}
   {modal==='delete'?<><p>This requests deletion of your account details and saved points. This cannot be undone after confirmation.</p>{errors}<div className="dialog-actions"><button className="primary danger-button" disabled={busy} onClick={deleteData}>Delete my data</button><button className="text-button" disabled={busy} onClick={close}>Keep my data</button></div></>:null}
   {modal==='share'?<><p className="share-text" tabIndex={0}>{shareText}</p><div className="dialog-actions"><button className="primary" onClick={()=>void copy()}>Copy my score</button><button className="text-button" onClick={close}>Done</button></div></>:null}
  </dialog>:null}
  {notice?<div className="toast" role="status">{notice}</div>:null}
 </>);
}
createRoot(document.getElementById('account-root')).render(<App/>);
