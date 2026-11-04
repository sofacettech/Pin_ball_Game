import {brandText} from '../../shared/brand-react.jsx';
import React, {useEffect, useEffectEvent, useRef, useState} from 'react';
import {createRoot} from 'react-dom/client';
import {request, pendingResult} from './api.js';
import {countries, normalisePhone, phoneCountry, maskedPhone} from './phone.js';
import {capitaliseName,splitPlayerName,publicPlayerName,validPlayerName,leaveCopy,exitCopy} from '../../game-source/src/player-copy.ts';
import {BrandText} from '../../assets/brand-text.jsx';
import {accountHref,accountSignInHref,accountNavigationHref} from '../../shared/account-session.js';
import {ClaimButterfly, ClaimScene} from './claim-scene.jsx';
import './style.css';

const embedded = window.parent !== window;
const firstCutsJoin = new URLSearchParams(location.search).get('from')==='first-cuts';
const renewVerification = new URLSearchParams(location.search).get('verify')==='1';
const firstCutsConfirmationHref = accountNavigationHref('/first-cuts-confirmation.html');
const numbers = new Intl.NumberFormat('en-IN');
const money = value => '₹' + numbers.format(Math.floor(value / 10)) + (value % 10 ? '.' + value % 10 : '');
const post = data => { if (embedded) window.parent.postMessage(data, location.origin); };
const initialDetails = {name:'',email:'',city:'',termsAccepted:false,privacyAccepted:false,marketingConsent:false};
const suggestName=value=>{const {firstName,lastInitial}=splitPlayerName(value);return publicPlayerName(firstName,lastInitial).slice(0,30).trim()};

function Icon({name, ...props}) { return <svg aria-hidden="true" {...props}><use href={'/assets/membership/icons.svg#'+name}/></svg>; }
function CrystalButton({children, arrow=false, className='', ...props}) {
  return <button className={'crystal-button '+className} {...props}><span>{children}</span>{arrow&&<Icon name="arrow" className="arrow" viewBox="0 0 34 28"/>}</button>;
}
function Field({id, label, icon, error, ...props}) {
  const input = <input id={id} aria-invalid={!!error} aria-describedby={id+'-error'} {...props}/>;
  return <div className={'field '+(icon?'':'front-field')}><label className={icon?'field-label':'sr-only'} htmlFor={id}>{label}{icon&&props.required&&<span className="required" aria-hidden="true">*</span>}</label>{icon?<div className="input-line"><Icon name={icon} viewBox="0 0 26 26" fill="none" stroke="currentColor"/>{input}</div>:input}<span className="field-error" id={id+'-error'}>{error}</span></div>;
}
function PhoneField({id,country,onCountry,compact=false,...props}) {
  const callingCode=countries.find(item=>item.code===country)?.dial||'Code';
  return <div className={'phone-field'+(compact?' phone-field-compact':'')}>
    <label className={compact?'sr-only':'country-label'} htmlFor={id+'-country'}>Country and calling code</label>
    <div className="country-control"><select id={id+'-country'} autoComplete="country" value={country} disabled={props.disabled} onChange={event=>onCountry(event.target.value)}>{countries.map(item=><option key={item.code} value={item.code}>{item.name} ({item.dial})</option>)}<option value="">International number (+ code)</option></select>{compact&&<span className="calling-code-value" aria-hidden="true">{callingCode}<svg width="12" height="8" viewBox="0 0 12 8" fill="none"><path d="m1 1 5 5 5-5" stroke="currentColor" strokeWidth="1.5"/></svg></span>}</div>
    <Field id={id} label="Mobile number" name={id} type="tel" inputMode="tel" placeholder={country?'Mobile number':'Include + country code'} autoComplete="tel" maxLength={30} required {...props}/>
  </div>;
}
function selectShareCopy(element) {
  const selection=window.getSelection();if(!selection)return;
  const range=document.createRange();range.selectNodeContents(element);selection.removeAllRanges();selection.addRange(range);
}
function App() {
  const [identity,setIdentity]=useState({phone:'',country:'IN'}),[details,setDetails]=useState(initialDetails);
  const [stage,setStage]=useState('identity'),[requestedPhones,setRequestedPhones]=useState(()=>new Set());
  const [errors,setErrors]=useState({}),[status,setStatus]=useState(''),[busy,setBusy]=useState(false);
  const [pending,setPending]=useState(null),[config,setConfig]=useState(null),[challenge,setChallenge]=useState(null),[proof,setProof]=useState(null);
  const [otp,setOtp]=useState(''),[resendAt,setResendAt]=useState(0),[seconds,setSeconds]=useState(0),[changing,setChanging]=useState(false),[newPhone,setNewPhone]=useState('');
  const [saved,setSaved]=useState(null),[dialog,setDialog]=useState(null),[shareStatus,setShareStatus]=useState('');
  const [memberCheck,setMemberCheck]=useState('checking');
  const [revealed,setRevealed]=useState(false),[skipEntrance,setSkipEntrance]=useState(false);
  const claimContent=useRef(null);
  const [exit,setExit]=useState(null),[newCountry,setNewCountry]=useState('IN');
  const controller=useRef(null),locked=useRef(false),policyDialog=useRef(null),mounted=useRef(true),pendingRef=useRef(null),exitHandler=useRef(null),exitDestination=useRef('/');
  const joining=firstCutsJoin&&!pending;
  const reauth=renewVerification&&!joining;
  const phoneNumber=normalisePhone(identity.phone,identity.country);
  const otpReady=!!phoneNumber&&(reauth||(details.termsAccepted&&validPlayerName(details.name)));
  const policiesMissing=config?.otpAvailable&&(!config.policies?.terms||!config.policies?.privacy);
  const codeRequested=requestedPhones.has(phoneNumber);
  const canSend=stage==='identity'&&!joining&&!exit&&!dialog&&memberCheck==='guest'
    &&otpReady&&!!config&&!policiesMissing&&!seconds&&!busy;
  const hasUnsaved=()=>!!pendingRef.current&&pendingRef.current.points>=10&&!saved;
  function requestExit(destination='/') {
    if(locked.current){setStatus('Please wait for the current request to finish.');return}
    if(!hasUnsaved()){if(typeof destination==='function')destination();else window.top.location.assign(destination);return}
    exitDestination.current=typeof destination==='string'?destination:'/';setExit('confirm');
  }
  function restoreDraft(){
    setExit(null);
    requestAnimationFrame(()=>document.getElementById(stage==='details'?'save-email':stage==='confirmation'?(changing?'new-phone':'final-otp'):reauth?'phone':'front-name')?.focus({preventScroll:true}));
  }
  exitHandler.current=(destination,escape=false)=>{if(escape&&exit==='confirm'){restoreDraft();return}requestExit(destination)};
  async function checkMembership(signal) {
    if(!signal){controller.current?.abort();controller.current=new AbortController();signal=controller.current.signal}
    setMemberCheck('checking');
    try{
      const player=await request('/api/player',undefined,signal);
      if(signal.aborted||!mounted.current)return;
      if(typeof player.member!=='boolean')throw new Error('Membership could not be checked.');
      if(player.member&&renewVerification){
        setStatus('Please verify your phone again to save your points.');setMemberCheck('guest');
      }
      else if(player.member){setMemberCheck('member');if(embedded)post({type:'sofacet:membership-existing'});else location.replace(accountHref)}
      else setMemberCheck('guest');
    }catch(error){if(!signal.aborted&&mounted.current)setMemberCheck('error')}
  }
  useEffect(()=>{
    const abort=new AbortController();
    Object.defineProperty(window,'sofacetPendingReward',{get:()=>pendingRef.current,configurable:true});
    const receive=event=>{if(!embedded||event.origin!==location.origin||event.source!==window.parent)return;if(event.data?.type==='sofacet:pending-reward'){const result=pendingResult(event.data.result);if(result){pendingRef.current=result;setPending(result)}}else if(event.data?.type==='sofacet:request-exit')exitHandler.current(()=>post({type:'contest-registration:close'}),true)};
    const escape=event=>{if(event.key==='Escape'&&!policyDialog.current?.open){event.preventDefault();exitHandler.current(embedded?()=>post({type:'contest-registration:close'}):'/',true)}};
    const navigate=event=>{
      if(event.defaultPrevented||event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;
      const link=event.target instanceof Element?event.target.closest('a[href]'):null;if(!link||link.target==='_blank'||link.hasAttribute('download'))return;
      const url=new URL(link.href,location.href);if(!['http:','https:'].includes(url.protocol)||url.href===location.href)return;
      if(pendingRef.current?.points>=10){event.preventDefault();exitHandler.current(url.href)}
    };
    window.addEventListener('message',receive);document.addEventListener('keydown',escape);document.addEventListener('click',navigate,true);
    request('/api/membership/config',undefined,abort.signal).then(setConfig).catch(error=>{if(!abort.signal.aborted)setStatus(error.message)});
    void checkMembership(abort.signal);
    post({type:'sofacet:membership-ready'});
    return ()=>{mounted.current=false;abort.abort();controller.current?.abort();window.removeEventListener('message',receive);document.removeEventListener('keydown',escape);document.removeEventListener('click',navigate,true);delete window.sofacetPendingReward};
  },[]);
  useEffect(()=>{if(!hasUnsaved())return;const guard=event=>{event.preventDefault();event.returnValue=''};addEventListener('beforeunload',guard);return()=>removeEventListener('beforeunload',guard)},[pending,saved]);
  useEffect(()=>{if(exit)document.getElementById('exit-title')?.focus({preventScroll:true})},[exit]);
  useEffect(()=>{
    const tick=()=>setSeconds(Math.max(0,Math.ceil((resendAt-Date.now())/1000)));
    tick();
    if(resendAt){const timer=setInterval(tick,1000);return ()=>clearInterval(timer)}
  },[resendAt]);
  useEffect(()=>{
    const target=stage==='confirmation'?(changing?'new-phone':'final-otp'):stage==='details'?'save-heading':stage==='success'?'success':null;
    if(!target)return;
    const frame=requestAnimationFrame(()=>document.getElementById(target)?.focus());
    return ()=>cancelAnimationFrame(frame);
  },[stage,changing]);
  useEffect(()=>{if(dialog&&!policyDialog.current.open)policyDialog.current.showModal()},[dialog]);
  const clear=id=>setErrors(current=>({...current,[id]:''}));
  const change=(key,id)=>event=>{
    const {type,checked,value:input}=event.target;
    const value=type==='checkbox'?checked:key==='name'?capitaliseName(input):input;
    setDetails(current=>({...current,[key]:value}));clear(id);
  };
  async function run(action) {
    if(locked.current)return;
    locked.current=true;setBusy(true);setStatus('');controller.current=new AbortController();
    try{await action(controller.current.signal)}catch(error){if(mounted.current&&!controller.current.signal.aborted){
      setStatus(error.message||'Please try again.');
      if(Number.isFinite(error.retryAfter))setResendAt(Date.now()+error.retryAfter*1000);
      if(['invalid_token','rewards_verification_required'].includes(error.code)){setProof(null);setChallenge(null);setOtp('');setStage('identity')}
    }}finally{locked.current=false;if(mounted.current)setBusy(false)}
  }
  function validate(found) {
    setErrors(found);
    const id=Object.keys(found)[0];
    if(!id)return true;
    setStatus('Please check the highlighted fields.');
    document.getElementById(id)?.focus();
    return false;
  }
  async function sendCode(signal,phone=normalisePhone(identity.phone,identity.country)) {
    if(!phone)throw new Error('Please check your country code and phone number.');
    setProof(null);setChallenge(null);
    const result=await request(reauth?'/api/account/otp/request':'/api/membership/otp/request',reauth?{phoneNumber:phone}:{phoneNumber:phone,name:details.name.trim(),consent:details.termsAccepted},signal);
    if(result.success!==true||typeof result.challengeId!=='string'||!Number.isFinite(result.expiresIn)||result.expiresIn<=0)throw new Error('We couldn’t send your code. Please try again.');
    setIdentity(current=>({...current,phone,country:phoneCountry(phone,current.country)}));setChallenge({id:result.challengeId,expiresAt:Date.now()+result.expiresIn*1000,channel:result.deliveryChannel});setProof(null);setOtp('');setResendAt(Date.now()+(result.resendAfter??60)*1000);setChanging(false);setStage('confirmation');
  }
  function requestInitialCode() {
    if(!canSend||locked.current)return;
    void run(signal=>{
      setRequestedPhones(current=>new Set(current).add(phoneNumber));
      return sendCode(signal,phoneNumber);
    });
  }
  const sendAutomaticCode=useEffectEvent(requestInitialCode);
  useEffect(()=>{
    if(!canSend||codeRequested)return;
    const timer=setTimeout(sendAutomaticCode,700);
    return ()=>clearTimeout(timer);
  },[canSend,codeRequested,phoneNumber,details.name]);
  function begin(event) {
    event.preventDefault();
    if(busy||seconds>0)return;
    if(!joining){if(codeRequested)requestInitialCode();return}
    const found={};
    if(!validPlayerName(details.name))found['front-name']='Please enter your full name.';
    if(!normalisePhone(identity.phone,identity.country))found.phone='Enter a valid number for the selected country, or include + and your country code.';
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(details.email.trim()))found.email='Enter a valid email address.';
    if(!details.privacyAccepted)found.terms='Please agree to the Privacy Policy to continue.';
    if(!details.marketingConsent)found.marketing='Please confirm updates and early access to join.';
    if(validate(found))setStatus('Joining the early-access list is not available yet. Please try again later.');
  }
  function confirm(event) {
    event.preventDefault();if(busy)return;
    if(!/^\d{6}$/.test(otp)){validate({'final-otp':'Enter the six-digit code.'});return}
    void run(async signal=>{
      if(!challenge||Date.now()>challenge.expiresAt)throw new Error('This code expired. Please request a new one.');
      if(reauth&&pending&&!pending.gameId)throw new Error('This game could not connect for verification. Please play another round to save points.');
      if(reauth){
        if(!proof){const verified=await request('/api/account/otp/verify',{phoneNumber:normalisePhone(identity.phone,identity.country),otp,challengeId:challenge.id},signal);if(verified.verified!==true)throw new Error('Your phone could not be verified.');setProof('account-verified')}
        const account=await request('/api/account',undefined,signal),player=await request('/api/player',undefined,signal);
        const reward=pending?await request('/api/membership/rewards',{gameId:pending.gameId},signal):{pointsSaved:false,savedPoints:account.savedPoints,remainingPoints:0};
        if(pending&&reward.pointsSaved!==true)throw new Error('Your points have not been confirmed as saved.');
        setDetails(current=>({...current,name:account.name,email:account.email}));pendingRef.current=null;setSaved({...reward,player});setStage('success');setResendAt(0);post({type:'contest-registration:complete',player});
        if(!embedded)location.replace(pending?'/play.html#leaderboard':accountHref);return;
      }
      const result=await request('/api/membership/otp/verify',{phoneNumber:normalisePhone(identity.phone,identity.country),otp,challengeId:challenge.id},signal);
      if(result.verified!==true||typeof result.verificationToken!=='string')throw new Error('That code doesn’t match. Check it and try again.');
      const content = claimContent.current;
      if (content?.animate && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
        const departure = content.animate([{opacity:1,transform:'none'},{opacity:0,transform:'translateX(42px)'}],{duration:500,easing:'ease-in',fill:'forwards'});
        const cancel = () => departure.cancel();
        signal.addEventListener('abort',cancel,{once:true});
        await departure.finished.catch(()=>{});
        signal.removeEventListener('abort',cancel);
        requestAnimationFrame(cancel);
      }
      if (signal.aborted) return;
      setProof(result.verificationToken);setStage('details');setResendAt(0);
      window.scrollTo(0,0);
    });
  }
  function save(event) {
    event.preventDefault();if(busy||saved)return;
    const found={};
    if(!validPlayerName(details.name))found['save-name']='Please enter your full name.';
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(details.email.trim()))found['save-email']='Enter a valid email address.';
    if(!details.city.trim())found['save-city']='Please enter your city.';
    if(!details.termsAccepted)found.terms='Please accept the terms to continue.';
    if(!validate(found))return;
    if(!proof){setStage('identity');setStatus('Please verify your mobile number again.');return}
    if(pending&&!pending.gameId){setStatus('This game could not connect for verification. Please play another round to save points.');return}
    void run(async signal=>{
      const result=await request('/api/membership',{name:details.name.trim(),leaderboardName:suggestName(details.name),email:details.email.trim(),city:details.city.trim(),termsAccepted:details.termsAccepted,marketingConsent:details.marketingConsent,phoneNumber:normalisePhone(identity.phone,identity.country),verificationToken:proof,...(pending?.gameId?{gameId:pending.gameId}:{})},signal);
      if(result.success!==true||result.player?.member!==true||pending&&result.pointsSaved!==true||!Number.isSafeInteger(result.savedPoints)||result.savedPoints<0||!Number.isSafeInteger(result.remainingPoints)||result.remainingPoints<0)throw new Error('Your points haven’t been confirmed as saved. Please try again.');
      pendingRef.current=null;setSaved(result);setStage('success');setResendAt(0);post({type:'contest-registration:complete',player:result.player});
      if(!embedded)location.replace(firstCutsJoin&&!pending?firstCutsConfirmationHref:'/play.html#leaderboard');
    });
  }
  const replay=()=>{if(embedded)post({type:'sofacet:membership-replay'});else location.assign('/play.html')};
  function back() {
    if(busy)return;
    setErrors({});setStatus('');
    if(embedded&&pendingRef.current&&!changing&&(stage==='identity'||stage==='confirmation')){
      post({type:'contest-registration:close',returnToScore:true});return;
    }
    if(stage==='confirmation'||stage==='details'){if(changing)setChanging(false);else{setStage('identity');setChallenge(null);setProof(null);setOtp('')}return}
    requestExit('/');
  }
  function policy(kind) {
    const url=config?.policies?.[kind];
    if(url){window.open(url,'_blank','noopener,noreferrer');return}
    setDialog({title:kind==='terms'?'Terms and Conditions':'Privacy Policy',copy:''});
  }
  async function share() {
    const text=pending?'I unlocked a facet in the SO/ FACET world and scored '+numbers.format(pending.points)+'. What’s yours?\n'+location.origin+'/':'SO/ FACET. Coming soon. What’s yours?\n'+location.origin+'/';
    try{if(navigator.share){await navigator.share({title:'SO/ FACET · My score',text});return}if(navigator.clipboard?.writeText){await navigator.clipboard.writeText(text);setShareStatus('Your score message was copied.');return}}catch(error){if(error.name==='AbortError')return}
    setDialog({title:'Share your score',copy:'Copy your score message below.',text});
  }
  const verifying=stage==='confirmation',saving=stage==='details',codeScreen=stage==='identity'||verifying;
  const consent=<div className="consents">
    <div className="consent-row">
      <input id="terms" name={joining?'privacyAccepted':'termsAccepted'} type="checkbox" required checked={joining?details.privacyAccepted:details.termsAccepted} aria-invalid={!!errors.terms} aria-describedby="terms-error" disabled={busy} onChange={change(joining?'privacyAccepted':'termsAccepted','terms')}/>
      <label htmlFor="terms">I’m 18 or older and I agree to {joining?<>the <button className="text-link" type="button" onClick={()=>policy('privacy')}>Privacy Policy</button></>:<>the <button className="text-link" type="button" onClick={()=>policy('terms')}>Terms and Conditions</button> and <button className="text-link" type="button" onClick={()=>policy('privacy')}>Privacy Policy</button>{!saving&&', and I agree to receive a verification code'}</>}. <span aria-hidden="true">*</span></label>
    </div>
    <span className="field-error" id="terms-error">{errors.terms}</span>
    {(saving||joining)&&<div className="consent-row">
      <input id="marketing" name="marketingConsent" type="checkbox" required={joining} aria-invalid={!!errors.marketing} aria-describedby="marketing-error" checked={details.marketingConsent} disabled={busy} onChange={change('marketingConsent','marketing')}/>
      <label htmlFor="marketing">{joining?'Send me SO/ FACET updates and early access.':'Send me SO/ FACET news and launch updates.'}</label>
    </div>}
    <span className="field-error" id="marketing-error">{errors.marketing}</span>
  </div>;
  return brandText(<>
    {memberCheck==='guest'&&<ClaimScene contentRef={claimContent} revealed={revealed} onReveal={setRevealed}/>}
    <a className="membership-close" href="/" target="_top" aria-label="Return to landing page">×</a>
    <main className={'membership-page'+(saving&&!exit?' is-details':'')}>{exit?<section className="membership-exit" aria-labelledby="exit-title"><p className="eyebrow">{exit==='confirm'?'BEFORE YOU GO':exitCopy.label}</p><h1 id="exit-title" tabIndex={-1}>{exit==='confirm'?leaveCopy(pending.points).title:exitCopy.title}</h1><p className="step-copy">{exit==='confirm'?leaveCopy(pending.points).support:exitCopy.support}</p><div className="exit-actions">{exit==='confirm'?<><CrystalButton type="button" arrow onClick={restoreDraft}>Save my points</CrystalButton><button className="secondary-button" type="button" onClick={()=>{pendingRef.current=null;setPending(null);post({type:'sofacet:reward-discarded'});setExit('left')}}>Leave anyway</button></>:<><CrystalButton type="button" onClick={replay}>Play again</CrystalButton><button className="secondary-button" type="button" onClick={()=>window.top.location.assign(exitDestination.current)}>Back to the world</button></>}</div>{exit==='left'&&<><a className="exit-updates" href={accountNavigationHref('/launching-soon.html')} target="_top">Just want updates? Join THE FIRST CUT →</a><p className="sign-off"><BrandText>{exitCopy.signoff}</BrandText></p></>}</section>:memberCheck!=='guest'?<div className="membership-layout"><p className="step-copy" role="status">{memberCheck==='error'?'We couldn’t check your account.':memberCheck==='member'?'Opening the leaderboard…':'Checking your account…'}{memberCheck==='error'&&<button className="secondary-button" type="button" onClick={()=>void checkMembership()}>Try again</button>}</p></div>:<div className="membership-layout">
      <section className={'left-column claim-content'+(revealed?' is-revealed':'')+(skipEntrance?' skip-entrance':'')} ref={claimContent} onFocusCapture={()=>{setRevealed(true);setSkipEntrance(true)}} aria-label="SO/ FACET account">
        <button className="membership-back" type="button" aria-label="Go back" onClick={back} disabled={busy} hidden={!!saved}><Icon name="arrow" viewBox="0 0 34 28"/></button>
        <p className={'claim-eyebrow'+(saving?' details-eyebrow':'')}>{saving?'YOUR WIN':pending?'GAME COMPLETE':'THE FIRST CUT'}</p>
        {codeScreen&&<>
          <h1 className="claim-heading">Join “THE FIRST CUT”<ClaimButterfly color="yellow" revealed={revealed}/></h1>
          {pending&&<p className="claim-reward">{numbers.format(pending.points)} SO/ Coins · {money(pending.points)} off SO/ FACET diamond jewellery</p>}
          <form className="claim-form" id="identity-form" onSubmit={verifying?confirm:begin} noValidate aria-busy={busy} hidden={changing}>
            {!reauth&&<Field id="front-name" label="Full name" name="name" placeholder="Full name" autoComplete="name" maxLength={80} required value={details.name} error={errors['front-name']} disabled={busy||verifying} onChange={change('name','front-name')}/>}
            <PhoneField id="phone" compact disabled={busy||verifying} country={identity.country} onCountry={country=>{setIdentity(current=>({...current,country}));clear('phone')}} value={identity.phone} error={errors.phone} onChange={event=>{const phone=event.target.value;setIdentity(current=>({...current,phone,country:phone.startsWith('+')?phoneCountry(phone,current.country):current.country}));clear('phone')}}/>
            {joining?<Field id="email" label="Email" name="email" type="email" placeholder="Email" autoComplete="email" maxLength={254} required value={details.email} error={errors.email} onChange={change('email','email')}/>:<Field id="final-otp" label="Six-digit verification code" name="confirmationCode" placeholder="OTP" type="text" inputMode="numeric" autoComplete="one-time-code" maxLength={6} required disabled={!verifying||busy} value={otp} error={errors['final-otp']} onChange={event=>{setOtp(event.target.value.replace(/\D/g,'').slice(0,6));clear('final-otp')}}/>}
            <p className="claim-signin">Already saved your So/ Coins? <a href={accountSignInHref} target="_top">Sign in</a></p>
            <p className="claim-help" id="confirmation-copy">{verifying?<>We’ve sent a 6-digit code by {challenge?.channel==='whatsapp'?'WhatsApp':'SMS'} to {maskedPhone(normalisePhone(identity.phone,identity.country))}.</>:<>We’ll send a code by WhatsApp or SMS to confirm it’s you. So/ Coins can be used once our shop opens and expire 6 months after it opens. Terms apply.</>}</p>
            {!verifying&&!reauth&&consent}
            <CrystalButton className="claim-action" type="submit" arrow disabled={busy||(!verifying&&!joining&&(!codeRequested||!canSend))}>{busy?(verifying?'Please wait…':'Sending code…'):joining?'Join THE FIRST CUT':!verifying&&codeRequested?(seconds?'Try again in '+seconds+'s':'Try again'):'Verify code'}</CrystalButton>
            {verifying&&<div className="confirmation-links"><button className="text-link" type="button" disabled={busy||seconds>0} onClick={()=>void run(async signal=>{await sendCode(signal);setStatus('A new code is on its way. Check your messages.')})}>{seconds?'Resend code (in '+Math.floor(seconds/60)+':'+String(seconds%60).padStart(2,'0')+')':'Resend code'}</button><span aria-hidden="true">·</span><button className="text-link" type="button" disabled={busy} onClick={()=>{setNewPhone(identity.phone);setNewCountry(identity.country);setChanging(true);setStatus('')}}>Change number</button></div>}
          </form>
          <form className="change-number" hidden={!changing} onSubmit={event=>{event.preventDefault();const phone=normalisePhone(newPhone,newCountry);if(!phone){validate({'new-phone':'Enter a valid number with its country code.'});return}void run(signal=>sendCode(signal,phone))}} noValidate><PhoneField id="new-phone" compact country={newCountry} onCountry={setNewCountry} disabled={busy} value={newPhone} error={errors['new-phone']} onChange={event=>{setNewPhone(event.target.value);clear('new-phone')}}/><div className="confirmation-links"><button className="text-link" type="submit" disabled={busy}>Send code</button><button className="text-link" type="button" disabled={busy} onClick={()=>setChanging(false)}>Cancel</button></div></form>
        </>}
        {saving&&<>
          <h1 className="save-heading" id="save-heading" tabIndex={-1}>Save Your So/ Coins</h1>
          <form className="save-form" id="save-details" onSubmit={save} noValidate aria-busy={busy}>
            <Field id="save-name" icon="person" label="Name" name="name" placeholder="Name" autoComplete="name" required readOnly value={details.name} error={errors['save-name']} disabled={busy}/>
            <Field id="save-email" icon="mail" label="Email" name="email" type="email" placeholder="Email address" autoComplete="email" maxLength={254} required value={details.email} error={errors['save-email']} disabled={busy} onChange={change('email','save-email')}/>
            <div className="split-fields">
              <Field id="save-dob" icon="calendar" label="Date of birth" placeholder="DD / MM / YYYY" aria-describedby="details-coming" disabled/>
              <Field id="save-city" icon="pin" label="City" name="city" placeholder="Your city" autoComplete="address-level2" maxLength={100} required disabled={busy} value={details.city} error={errors['save-city']} onChange={change('city','save-city')}/>
            </div>
            <p className="claim-help" id="details-coming">Date of birth will be available later.</p>
            {consent}
            <CrystalButton className="claim-action" type="submit" arrow disabled={busy||!details.termsAccepted}>{busy?'Saving…':'Save my SO/ Coins'}</CrystalButton>
            <p className="closing-line">Keep them before they disappear.</p>
          </form>
        </>}
        {(codeScreen||saving)&&<><p className="connection-status" role="status">{status||(!joining&&stage==='identity'&&otpReady&&policiesMissing?'Account terms are not available yet. Please try again later.':'')}</p>{!joining&&<button className="text-link claim-replay" type="button" onClick={replay} disabled={busy}>Play again</button>}</>}
            <section className="success" id="success" hidden={stage!=='success'} aria-labelledby="success-title" tabIndex={-1}>
              <p className="step-eyebrow">{saved?.pointsSaved?<span className="brand-word">SO/ SAVED</span>:'ACCOUNT ACTIVE'}</p><h2 className="step-title" id="success-title">It’s yours, <span>{details.name.trim().split(/\s+/)[0]}.</span></h2>
              <p className="step-copy">You made “THE FIRST CUT”.</p>
              <p className="step-copy">{saved?.pointsSaved?<>{numbers.format(saved.savedPoints)} points ({money(saved.savedPoints)} off) are saved for <BrandText>SO/ FACET</BrandText> diamond jewellery. When our doors open, start collecting your facets.</>:<BrandText>You made “THE FIRST CUT”. Play a round to earn points.</BrandText>}</p>
              {!!saved?.remainingPoints&&<p className="step-copy">Your remaining {saved.remainingPoints} game points are kept with your best score. Rewards are credited in groups of 10 points.</p>}
              <p className="leaderboard-line">Your leaderboard name: {suggestName(details.name)}</p>
              <div className="success-bottom"><p className="replay-nudge">Want more? Play again. Only your best score counts.</p><div className="success-actions"><button className="secondary-button" type="button" onClick={replay}>Play again</button><CrystalButton type="button" onClick={()=>void share()}>Share my score</CrystalButton></div><p className="sign-off"><BrandText>SO/ FACET. Coming soon. What’s yours?</BrandText></p><p className="sr-only" role="status">{shareStatus}</p></div>
            </section>
      </section>
    </div>}</main>
    <dialog ref={policyDialog} aria-labelledby="dialog-title" onClose={()=>setDialog(null)}><h2 id="dialog-title">{dialog?.title}</h2><p>{dialog?.copy}</p>{dialog?.text&&<div className="share-copy" role="textbox" aria-label="Score message to copy" aria-readonly="true" aria-multiline="true" tabIndex={0} onFocus={event=>selectShareCopy(event.currentTarget)} onKeyDown={event=>{if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='a'){event.preventDefault();selectShareCopy(event.currentTarget)}}}>{dialog.text}</div>}<div className="dialog-actions"><button type="button" onClick={()=>policyDialog.current.close()}>Close</button></div></dialog>
  </>);
}
createRoot(document.getElementById('membership-root')).render(<App/>);
