import {brandText} from '../../shared/brand-react.jsx';
import React, {useEffect, useRef, useState} from 'react';
import {createRoot} from 'react-dom/client';
import {request, pendingResult} from './api.js';
import {countries, normalisePhone, phoneCountry, maskedPhone} from './phone.js';
import {birthDateState,underAgeCopy,splitPlayerName,publicPlayerName,validPlayerName,validPublicName,leaveCopy,exitCopy} from '../../game-source/src/player-copy.ts';
import './style.css';

const embedded = window.parent !== window;
const numbers = new Intl.NumberFormat('en-IN');
const money = value => '₹' + numbers.format(Math.floor(value / 10)) + (value % 10 ? '.' + value % 10 : '');
const post = data => { if (embedded) window.parent.postMessage(data, location.origin); };
const initialDetails = {name:'',leaderboardName:'',email:'',dateOfBirth:'',city:'',termsAccepted:false,marketingConsent:false};
const suggestName=value=>{const {firstName,lastInitial}=splitPlayerName(value);return publicPlayerName(firstName,lastInitial)};

function Icon({name, ...props}) { return <svg aria-hidden="true" {...props}><use href={'/assets/membership/icons.svg#'+name}/></svg>; }
function CrystalButton({children, arrow=false, className='', ...props}) {
  return <button className={'crystal-button '+className} {...props}><span>{children}</span>{arrow&&<Icon name="arrow" className="arrow" viewBox="0 0 34 28"/>}</button>;
}
function Field({id, label, icon, error, ...props}) {
  const input = <input id={id} aria-invalid={!!error} aria-describedby={id+'-error'} {...props}/>;
  return <div className={'field '+(icon?'':'front-field')}><label className={icon?'field-label':'sr-only'} htmlFor={id}>{label}{icon&&<span className="required" aria-hidden="true">*</span>}</label>{icon?<div className="input-line"><Icon name={icon} viewBox="0 0 26 26" fill="none" stroke="currentColor"/>{input}</div>:input}<span className="field-error" id={id+'-error'}>{error}</span></div>;
}
function PhoneField({id,country,onCountry,...props}) {
  return <div className="phone-field"><label className="country-label" htmlFor={id+'-country'}>Country / calling code</label><select id={id+'-country'} autoComplete="country" value={country} disabled={props.disabled} onChange={event=>onCountry(event.target.value)}><option value="">International number (+ code)</option>{countries.map(item=><option key={item.code} value={item.code}>{item.name} ({item.dial})</option>)}</select><Field id={id} label="Phone number" name={id} type="tel" inputMode="tel" placeholder={country?'Phone number':'Include + country code'} autoComplete="tel" maxLength={30} required {...props}/></div>;
}
function App() {
  const [identity,setIdentity]=useState({name:'',phone:'',country:'IN'}),[details,setDetails]=useState(initialDetails);
  const [stage,setStage]=useState('identity'),[step,setStep]=useState(1),[compact,setCompact]=useState(matchMedia('(max-width:1100px)').matches);
  const [splitForm,setSplitForm]=useState(matchMedia('(max-width:1100px), (max-height:700px)').matches);
  const [errors,setErrors]=useState({}),[status,setStatus]=useState(''),[busy,setBusy]=useState(false);
  const [pending,setPending]=useState(null),[config,setConfig]=useState(null),[challenge,setChallenge]=useState(null),[proof,setProof]=useState(null);
  const [otp,setOtp]=useState(''),[resendAt,setResendAt]=useState(0),[seconds,setSeconds]=useState(0),[changing,setChanging]=useState(false),[newPhone,setNewPhone]=useState('');
  const [saved,setSaved]=useState(null),[dialog,setDialog]=useState(null),[shareStatus,setShareStatus]=useState('');
  const [memberCheck,setMemberCheck]=useState('checking');
  const [exit,setExit]=useState(null),[newCountry,setNewCountry]=useState('IN');
  const controller=useRef(null),locked=useRef(false),policyDialog=useRef(null),mounted=useRef(true),pendingRef=useRef(null),exitHandler=useRef(null),exitDestination=useRef('/index.html#experience'),nicknameEdited=useRef(false);
  const hasUnsaved=()=>!!pendingRef.current&&pendingRef.current.points>=10&&!saved;
  function requestExit(destination='/index.html#experience') {
    if(locked.current){setStatus('Please wait for the current request to finish.');return}
    if(!hasUnsaved()){if(typeof destination==='function')destination();else window.top.location.assign(destination);return}
    exitDestination.current=typeof destination==='string'?destination:'/index.html#experience';setExit('confirm');
  }
  function restoreDraft(){setExit(null);requestAnimationFrame(()=>document.getElementById(stage==='identity'?'front-name':stage==='details'?(step===1?'member-name':'birthdate'):changing?'new-phone':'final-otp')?.focus({preventScroll:true}))}
  exitHandler.current=(destination,escape=false)=>{if(escape&&exit==='confirm'){restoreDraft();return}requestExit(destination)};
  const flipped=stage!=='identity';
  async function checkMembership(signal) {
    if(!signal){controller.current?.abort();controller.current=new AbortController();signal=controller.current.signal}
    setMemberCheck('checking');
    try{
      const player=await request('/api/player',undefined,signal);
      if(signal.aborted||!mounted.current)return;
      if(typeof player.member!=='boolean')throw new Error('Membership could not be checked.');
      if(player.member){setMemberCheck('member');if(embedded)post({type:'sofacet:membership-existing'});else location.replace('/play.html#leaderboard')}
      else setMemberCheck('guest');
    }catch(error){if(!signal.aborted&&mounted.current)setMemberCheck('error')}
  }
  useEffect(()=>{
    const abort=new AbortController(),media=matchMedia('(max-width:1100px)'),formMedia=matchMedia('(max-width:1100px), (max-height:700px)');
    const resize=event=>setCompact(event.matches),resizeForm=event=>setSplitForm(event.matches);
    Object.defineProperty(window,'sofacetPendingReward',{get:()=>pendingRef.current,configurable:true});
    const receive=event=>{if(!embedded||event.origin!==location.origin||event.source!==window.parent)return;if(event.data?.type==='sofacet:pending-reward'){const result=pendingResult(event.data.result);if(result){pendingRef.current=result;setPending(result)}}else if(event.data?.type==='sofacet:request-exit')exitHandler.current(()=>post({type:'contest-registration:close'}),true)};
    const escape=event=>{if(event.key==='Escape'&&!policyDialog.current?.open){event.preventDefault();exitHandler.current(embedded?()=>post({type:'contest-registration:close'}):'/index.html#experience',true)}};
    const navigate=event=>{
      if(event.defaultPrevented||event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;
      const link=event.target instanceof Element?event.target.closest('a[href]'):null;if(!link||link.target==='_blank'||link.hasAttribute('download'))return;
      const url=new URL(link.href,location.href);if(!['http:','https:'].includes(url.protocol)||url.href===location.href)return;
      if(pendingRef.current?.points>=10){event.preventDefault();exitHandler.current(url.href)}
    };
    media.addEventListener('change',resize);formMedia.addEventListener('change',resizeForm);window.addEventListener('message',receive);document.addEventListener('keydown',escape);document.addEventListener('click',navigate,true);
    request('/api/membership/config',undefined,abort.signal).then(setConfig).catch(error=>{if(!abort.signal.aborted)setStatus(error.message)});
    void checkMembership(abort.signal);
    post({type:'sofacet:membership-ready'});
    return ()=>{mounted.current=false;abort.abort();controller.current?.abort();media.removeEventListener('change',resize);formMedia.removeEventListener('change',resizeForm);window.removeEventListener('message',receive);document.removeEventListener('keydown',escape);document.removeEventListener('click',navigate,true);delete window.sofacetPendingReward};
  },[]);
  useEffect(()=>{if(!hasUnsaved())return;const guard=event=>{event.preventDefault();event.returnValue=''};addEventListener('beforeunload',guard);return()=>removeEventListener('beforeunload',guard)},[pending,saved]);
  useEffect(()=>{if(exit)document.getElementById('exit-title')?.focus({preventScroll:true})},[exit]);
  useEffect(()=>{
    if(!resendAt)return;
    const tick=()=>setSeconds(Math.max(0,Math.ceil((resendAt-Date.now())/1000)));
    tick();const timer=setInterval(tick,1000);return ()=>clearInterval(timer);
  },[resendAt]);
  useEffect(()=>{
    const target=stage==='details'?(step===1?'member-name':'birthdate'):stage==='confirmation'?(changing?'new-phone':'final-otp'):stage==='success'?'success':null;
    const timer=setTimeout(()=>document.getElementById(target)?.focus({preventScroll:true}),flipped&&stage==='details'&&!matchMedia('(prefers-reduced-motion: reduce)').matches?1250:0);
    return ()=>clearTimeout(timer);
  },[stage,step,changing]);
  useEffect(()=>{if(dialog&&!policyDialog.current.open)policyDialog.current.showModal()},[dialog]);
  const clear=id=>setErrors(current=>({...current,[id]:''}));
  const change=(key,id)=>event=>{
    const value=event.target.type==='checkbox'?event.target.checked:event.target.value;
    if(key==='leaderboardName')nicknameEdited.current=true;
    setDetails(current=>{const next={...current,[key]:value};if(key==='name'&&!nicknameEdited.current)next.leaderboardName=suggestName(value);return next});clear(id);
  };
  async function run(action) {
    if(locked.current)return;
    locked.current=true;setBusy(true);setStatus('');controller.current=new AbortController();
    try{await action(controller.current.signal)}catch(error){if(mounted.current&&!controller.current.signal.aborted)setStatus(error.message||'Please try again.')}finally{locked.current=false;if(mounted.current)setBusy(false)}
  }
  function validate(first=false) {
    const found={};
    if(!validPlayerName(details.name))found['member-name']='Please enter your name.';
    if(!validPublicName(details.leaderboardName))found.leaderboard='Choose a name using letters (up to 30 characters).';
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(details.email.trim()))found.email='Enter a valid email address.';
    if(!first){const age=birthDateState(details.dateOfBirth);if(age!=='adult')found.birthdate=age==='underage'?'Saving is for ages 18 and up. You can play as a guest.':'Enter a valid date of birth.';if(!details.city.trim())found.city='Please enter your city.';if(!details.termsAccepted)found.terms='Please accept the terms to continue.'}
    setErrors(found);
    const id=Object.keys(found)[0];if(id){if(splitForm)setStep(['member-name','leaderboard','email'].includes(id)?1:2);setStatus('Please check the highlighted fields.');setTimeout(()=>document.getElementById(id)?.focus(),0);return false}
    return true;
  }
  function flip(event) {
    event.preventDefault();if(busy||flipped)return;
    const found={};if(!validPlayerName(identity.name))found['front-name']='Please enter your name.';if(!normalisePhone(identity.phone,identity.country))found.phone='Enter a valid number for the selected country, or include + and your country code.';setErrors(found);
    if(Object.keys(found).length){document.getElementById(Object.keys(found)[0]).focus();return}
    setDetails(current=>({...current,name:identity.name.trim(),leaderboardName:nicknameEdited.current?current.leaderboardName:suggestName(identity.name)}));setStatus('');setStage('details');
  }
  async function sendCode(signal,phone=normalisePhone(identity.phone,identity.country)) {
    if(!phone)throw new Error('Please check your country code and phone number.');
    const result=await request('/api/membership/otp/request',{phoneNumber:phone},signal);
    if(result.success!==true||typeof result.challengeId!=='string'||!Number.isFinite(result.expiresIn)||result.expiresIn<=0)throw new Error('We couldn’t send your code. Please try again.');
    setIdentity(current=>({...current,phone,country:phoneCountry(phone,current.country)}));setChallenge({id:result.challengeId,expiresAt:Date.now()+result.expiresIn*1000});setProof(null);setOtp('');setResendAt(Date.now()+(result.resendAfter||30)*1000);setChanging(false);setStage('confirmation');
  }
  function begin(event) {
    event.preventDefault();if(busy)return;
    if(splitForm&&step===1){if(validate(true))setStep(2);return}
    if(!validate())return;
    if(config?.otpAvailable&&(!config.policies?.terms||!config.policies?.privacy)){setStatus('Membership terms are not available yet. Please try again later.');return}
    void run(signal=>sendCode(signal));
  }
  async function confirm(event) {
    event.preventDefault();if(busy||saved)return;
    if(!/^\d{6}$/.test(otp)){setErrors(current=>({...current,'final-otp':'Enter the six-digit code.'}));document.getElementById('final-otp').focus();return}
    if(pending&&!pending.gameId){setStatus('This game could not connect for verification. Please play another round to save points.');return}
    void run(async signal=>{
      let token=proof;
      if(!token){
        if(!challenge||Date.now()>challenge.expiresAt)throw new Error('This code expired. Please request a new one.');
        const result=await request('/api/membership/otp/verify',{phoneNumber:normalisePhone(identity.phone,identity.country),otp,challengeId:challenge.id},signal);
        if(result.verified!==true||typeof result.verificationToken!=='string')throw new Error('That code doesn’t match. Check it and try again.');
        token=result.verificationToken;setProof(token);
      }
      const result=await request('/api/membership',{name:details.name.trim(),leaderboardName:details.leaderboardName.trim(),email:details.email.trim(),dateOfBirth:details.dateOfBirth,city:details.city.trim(),termsAccepted:details.termsAccepted,marketingConsent:details.marketingConsent,phoneNumber:normalisePhone(identity.phone,identity.country),verificationToken:token,...(pending?.gameId?{gameId:pending.gameId}:{})},signal);
      if(result.success!==true||result.player?.member!==true||pending&&result.pointsSaved!==true||!Number.isSafeInteger(result.savedPoints)||result.savedPoints<0||!Number.isSafeInteger(result.remainingPoints)||result.remainingPoints<0)throw new Error('Your points haven’t been confirmed as saved. Please try again.');
      pendingRef.current=null;setSaved(result);setStage('success');setResendAt(0);post({type:'contest-registration:complete',player:result.player});
      if(!embedded)location.replace('/play.html#leaderboard');
    });
  }
  const replay=()=>{if(embedded)post({type:'sofacet:membership-replay'});else location.assign('/play.html')};
  function back() {
    if(busy)return;
    setErrors({});setStatus('');
    if(stage==='confirmation'){if(changing)setChanging(false);else setStage('details');return}
    if(stage==='details'){
      if(splitForm&&step===2)setStep(1);
      else{setIdentity(current=>({...current,name:details.name}));setStage('identity')}
      return;
    }
    requestExit('/index.html#experience');
  }
  function policy(kind) {
    const url=config?.policies?.[kind];
    if(url){window.open(url,'_blank','noopener,noreferrer');return}
    setDialog({title:kind==='terms'?'Terms and Conditions':'Privacy Policy',copy:'The official policy is not available yet. Please check back before completing your membership.'});
  }
  async function share() {
    const text=pending?'I scored '+numbers.format(pending.points)+' in the So/Facet world.\nSo/Facet. Coming soon. What’s yours?\n'+location.origin+'/':'So/Facet. Coming soon. What’s yours?\n'+location.origin+'/';
    try{if(navigator.share){await navigator.share({title:'SO/FACET · My score',text});return}if(navigator.clipboard?.writeText){await navigator.clipboard.writeText(text);setShareStatus('Your score message was copied.');return}}catch(error){if(error.name==='AbortError')return}
    setDialog({title:'Share your score',copy:'Copy your score message below.',text});
  }
  const maximumDate=new Date();
  const maxBirth=[maximumDate.getFullYear(),String(maximumDate.getMonth()+1).padStart(2,'0'),String(maximumDate.getDate()).padStart(2,'0')].join('-');
  const summary=<aside className="score-section" aria-label="About your points"><h2>Keep them before<br/> they disappear.</h2><p className="score-copy">Unsaved points disappear when you leave this page.<br/>10 points = ₹1, and eligible points can be used toward up to 10% of the diamond value plus making charges on an order. <span className="best-score">Only your best score counts.</span></p></aside>;
  return brandText(<>
    <div className="scene" aria-hidden="true"/>
    <a className="membership-close" href="/index.html#experience" target="_top" aria-label="Return to landing page">×</a>
    <main className="membership-page">{exit?<section className="membership-exit" aria-labelledby="exit-title"><p className="eyebrow">{exit==='confirm'?'BEFORE YOU GO':exitCopy.label}</p><h1 id="exit-title" tabIndex={-1}>{exit==='confirm'?leaveCopy(pending.points).title:exitCopy.title}</h1><p className="step-copy">{exit==='confirm'?leaveCopy(pending.points).support:exitCopy.support}</p><div className="exit-actions">{exit==='confirm'?<><CrystalButton type="button" arrow onClick={restoreDraft}>Save my points</CrystalButton><button className="secondary-button" type="button" onClick={()=>{pendingRef.current=null;setPending(null);post({type:'sofacet:reward-discarded'});setExit('left')}}>Leave anyway</button></>:<><CrystalButton type="button" onClick={replay}>Play again</CrystalButton><button className="secondary-button" type="button" onClick={()=>window.top.location.assign(exitDestination.current)}>Back to the world</button></>}</div>{exit==='left'&&<p className="sign-off">{exitCopy.signoff}</p>}</section>:memberCheck!=='guest'?<div className="membership-layout"><p className="step-copy" role="status">{memberCheck==='error'?'We couldn’t check your membership.':memberCheck==='member'?'Opening the leaderboard…':'Checking your membership…'}{memberCheck==='error'&&<button className="secondary-button" type="button" onClick={()=>void checkMembership()}>Try again</button>}</p></div>:<div className="membership-layout">
      <section className="left-column" aria-label="SO/FACET membership">
        <button className="membership-back" type="button" aria-label="Go back" onClick={back} disabled={busy} hidden={memberCheck==='member'||!!saved}><Icon name="arrow" viewBox="0 0 34 28"/></button>
        <div className={'heading-stage '+(flipped?'is-reversed':'')}>
          <div className="heading heading-front" aria-hidden={flipped}><p className="eyebrow">{pending?'GAME COMPLETE':'SO/FACET MEMBERSHIP'}</p><h1>Become a <em>Member</em></h1></div>
          <div className="heading heading-back" aria-hidden={!flipped}><p className="eyebrow">SAVE YOUR WIN</p><h2>Save Your <em>Points</em></h2></div>
        </div>
        {compact&&summary}
        <div className="card-perspective"><div className={'flip-card '+(flipped?'is-flipped':'')}>
          <section className="card-face card-front" aria-label="Start your membership" aria-hidden={flipped} inert={flipped}><span className="edge-glint" aria-hidden="true"/>
            <form className="front-form" id="identity-form" onSubmit={flip} noValidate>
              <Field id="front-name" label="Your name" name="name" placeholder="Your name" autoComplete="name" maxLength={80} required value={identity.name} error={errors['front-name']} onChange={event=>{setIdentity(current=>({...current,name:event.target.value}));clear('front-name')}}/>
              <PhoneField id="phone" country={identity.country} onCountry={country=>{setIdentity(current=>({...current,country}));clear('phone')}} value={identity.phone} error={errors.phone} onChange={event=>{const phone=event.target.value;setIdentity(current=>({...current,phone,country:phone.startsWith('+')?phoneCountry(phone,current.country):current.country}));clear('phone')}}/>
              <p className="front-copy">Verify your number after “Save My Points”. Points can be used once the shop opens and expire 6 months after launch. Terms apply.</p>
              <div className="front-actions"><CrystalButton type="submit" arrow>Become a member</CrystalButton><button className="secondary-button" type="button" onClick={replay}><Icon name="replay" className="replay-icon" viewBox="0 0 40 40"/><span>Play again</span></button></div>
            </form>
          </section>
          <section className="card-face card-back" aria-label="Save your points" aria-hidden={!flipped} inert={!flipped}><span className="edge-glint" aria-hidden="true"/>
            <form className="back-form" id="member-form" data-step={step} hidden={stage!=='details'} onSubmit={begin} noValidate aria-busy={busy}>
              <p className="registration-progress" aria-live="polite">{step===1?'1 OF 2 · YOUR DETAILS':'2 OF 2 · FINISH YOUR MEMBERSHIP'}</p>
              <div className="registration-first">
                <Field id="member-name" label="Name" icon="person" name="name" placeholder="Name" autoComplete="name" maxLength={80} required value={details.name} error={errors['member-name']} disabled={busy} onChange={change('name','member-name')}/>
                <div className="two-column identity-row"><Field id="leaderboard" label="Leaderboard name" icon="trophy" name="leaderboardName" placeholder="Leaderboard name" autoComplete="nickname" maxLength={30} required value={details.leaderboardName} error={errors.leaderboard} disabled={busy} onChange={change('leaderboardName','leaderboard')}/><Field id="email" label="Email" icon="mail" name="email" type="email" placeholder="Email address" autoComplete="email" maxLength={254} required value={details.email} error={errors.email} disabled={busy} onChange={change('email','email')}/><p className="leaderboard-helper">Your leaderboard name, best score and rank are public. Names may be reviewed.</p></div>
              </div>
              <div className="registration-second"><div className="two-column details-row"><Field id="birthdate" label="Date of birth" icon="calendar" name="dateOfBirth" type="date" autoComplete="bday" min="1900-01-01" max={maxBirth} required value={details.dateOfBirth} error={errors.birthdate} disabled={busy} onChange={change('dateOfBirth','birthdate')}/><Field id="city" label="City" icon="pin" name="city" placeholder="Your city" autoComplete="address-level2" maxLength={100} required value={details.city} error={errors.city} disabled={busy} onChange={change('city','city')}/></div>
                {birthDateState(details.dateOfBirth)==='underage'&&<div className="guest-notice" role="status"><p>{underAgeCopy}</p><button className="text-link" type="button" onClick={replay}>Keep playing as a guest <span aria-hidden="true">→</span></button></div>}
                <div className="consents"><div className="consent-row"><input id="terms" name="termsAccepted" type="checkbox" required checked={details.termsAccepted} aria-invalid={!!errors.terms} aria-describedby="terms-error" disabled={busy} onChange={change('termsAccepted','terms')}/><label htmlFor="terms">I’m 18 or older and I agree to the <button className="text-link" type="button" onClick={()=>policy('terms')}>Terms and Conditions</button> and <button className="text-link" type="button" onClick={()=>policy('privacy')}>Privacy Policy</button>. <span className="required" aria-hidden="true">*</span></label></div><div className="consent-row"><input id="marketing" name="marketingConsent" type="checkbox" checked={details.marketingConsent} disabled={busy} onChange={change('marketingConsent','marketing')}/><label htmlFor="marketing">Send me So/Facet news and launch updates.</label></div><span className="field-error" id="terms-error">{errors.terms}</span></div>
              </div>
              <div className="registration-actions"><CrystalButton className="registration-next" type="button" disabled={busy} arrow onClick={()=>{if(validate(true)){setStatus('');setStep(2)}}}>Continue</CrystalButton><button className="secondary-button registration-back" type="button" disabled={busy} onClick={back}>Back</button><CrystalButton className="save-button" type="submit" disabled={busy} arrow>{busy?'Sending…':'Save my points'}</CrystalButton></div>
              <p className="form-status" role="status" aria-live="polite">{stage==='details'?status:''}</p>
            </form>
            <section className="confirmation" hidden={stage!=='confirmation'} aria-labelledby="confirmation-title" aria-busy={busy}>
              <p className="step-eyebrow">ONE LAST MOVE</p><h2 className="step-title" id="confirmation-title">Check your messages.</h2><p className="step-copy" id="confirmation-copy">We’ve sent a 6-digit code by SMS to {maskedPhone(normalisePhone(identity.phone,identity.country))}. Enter it to lock in your points.</p>
              <form className="confirmation-form" onSubmit={confirm} noValidate><label className="sr-only" htmlFor="final-otp">Six-digit confirmation code</label><input className="confirmation-code" id="final-otp" name="confirmationCode" type="text" inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="000000" required aria-describedby="confirmation-error confirmation-copy" aria-invalid={!!errors['final-otp']} disabled={busy} value={otp} onChange={event=>{setOtp(event.target.value.replace(/\D/g,'').slice(0,6));clear('final-otp')}}/><p className="confirmation-error" id="confirmation-error" role="alert">{errors['final-otp']}</p><CrystalButton className="confirm-button" type="submit" disabled={busy} arrow>{busy?'Saving…':'Confirm'}</CrystalButton></form>
              <div className="confirmation-links"><button className="text-link" type="button" disabled={busy||seconds>0} onClick={()=>void run(async signal=>{await sendCode(signal);setStatus('A new code is on its way. Check your messages.')})}>{seconds?'Resend code (in '+Math.floor(seconds/60)+':'+String(seconds%60).padStart(2,'0')+')':'Resend code'}</button><span aria-hidden="true">·</span><button className="text-link" type="button" disabled={busy} onClick={()=>{setNewPhone(identity.phone);setNewCountry(identity.country);setChanging(true);setStatus('')}}>Change number</button></div>
              <form className="change-number" hidden={!changing} onSubmit={event=>{event.preventDefault();const phone=normalisePhone(newPhone,newCountry);if(!phone){setErrors(current=>({...current,'new-phone':'Enter a valid number with its country code.'}));return}void run(signal=>sendCode(signal,phone))}} noValidate><div className="change-controls"><PhoneField id="new-phone" country={newCountry} onCountry={setNewCountry} disabled={busy} value={newPhone} error={errors['new-phone']} onChange={event=>{setNewPhone(event.target.value);clear('new-phone')}}/><button className="text-link" type="submit" disabled={busy}>Send code</button></div><button className="text-link" type="button" disabled={busy} onClick={()=>setChanging(false)}>Cancel</button></form>
              <p className="confirmation-status" role="status" aria-live="polite">{stage==='confirmation'?status:''}</p>
            </section>
            <section className="success" id="success" hidden={stage!=='success'} aria-labelledby="success-title" tabIndex={-1}>
              <p className="step-eyebrow">{saved?.pointsSaved?'POINTS SAVED':'MEMBERSHIP ACTIVE'}</p><h2 className="step-title" id="success-title">It’s official. They’re yours, <span>{details.name}.</span></h2>
              <p className="step-copy">{saved?.pointsSaved?numbers.format(saved.savedPoints)+' points ('+money(saved.savedPoints)+' off) are saved to your number. Spend them on So/Facet purchases when we open.':'Your So/Facet membership is active. Play a round to earn points.'}</p>
              {!!saved?.remainingPoints&&<p className="step-copy">Your remaining {saved.remainingPoints} game points are kept with your best score. Rewards are credited in groups of 10 points.</p>}
              <p className="step-copy">{details.marketingConsent?'You chose to receive So/Facet news and launch updates.':'Your launch-update preference is off.'}</p><p className="leaderboard-line">Your leaderboard name: {details.leaderboardName}</p>
              <div className="success-bottom"><p className="replay-nudge">Want more? Play again. Only your best score counts.</p><div className="success-actions"><button className="secondary-button" type="button" onClick={replay}>Play again</button><CrystalButton type="button" onClick={()=>void share()}>Share my score</CrystalButton></div><p className="sign-off">So/Facet. Coming soon. What’s yours?</p><p className="sr-only" role="status">{shareStatus}</p></div>
            </section>
          </section>
        </div></div>
        {stage==='identity'&&status&&<p className="connection-status" role="status">{status}</p>}
      </section>
      {!compact&&summary}
    </div>}</main>
    <dialog ref={policyDialog} aria-labelledby="dialog-title" onClose={()=>setDialog(null)}><h2 id="dialog-title">{dialog?.title}</h2><p>{dialog?.copy}</p>{dialog?.text&&<textarea readOnly aria-label="Score message to copy" value={dialog.text} onFocus={event=>event.target.select()}/>}<div className="dialog-actions"><button type="button" onClick={()=>policyDialog.current.close()}>Close</button></div></dialog>
  </>);
}
createRoot(document.getElementById('membership-root')).render(<App/>);
