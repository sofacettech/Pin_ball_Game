import React, {useEffect,useLayoutEffect,useRef,useState} from 'react';
import PageShell from './PageShell.jsx';
import {ClaimArtwork, ClaimMesh} from './artwork/ClaimArtwork.jsx';
import initialize from './scenes/claim.js';
import {countries} from '../membership-source/src/phone.js';
import {capitaliseName,formatPoints,rewardMoney} from '../game-source/src/player-copy.ts';
import {Arrow} from './icons.jsx';
import {normaliseDesignPhone} from './auth-values.js';
import {useSubmission} from './form-actions.js';

export default function ClaimPage({pageTitle='SO/ FACET — My SO/ COINS',result,confirmation=null,name = '',phone = '',dialCode = '+91',challengePhone,challengeId,twoStep=false,email='',onStart,termsUrl,privacyUrl,onClaim,onResend,onBack,onClose,onSignIn,status = '',resendSeconds = 0,working = false}) {
  const [showConfirmation,setShowConfirmation]=useState(Boolean(confirmation));
  const [detailsStep,setDetailsStep]=useState(false);
  const [leaving,setLeaving]=useState(false);
  const page=useRef(null),detailsHeading=useRef(null);
  useEffect(()=>{
    if(!leaving)return;
    const timer=setTimeout(()=>{setDetailsStep(true);setLeaving(false);},180);
    return()=>clearTimeout(timer);
  },[leaving]);
  useLayoutEffect(()=>{
    if(!detailsStep)return;
    window.scrollTo(0,0);
    detailsHeading.current?.focus({preventScroll:true});
  },[detailsStep]);
  useEffect(()=>{
    if(!confirmation||showConfirmation)return;
    const reduced=window.matchMedia('(prefers-reduced-motion:reduce)').matches;
    if(reduced){setShowConfirmation(true);return;}
    const timer=setTimeout(()=>setShowConfirmation(true),180);return()=>clearTimeout(timer);
  },[confirmation,showConfirmation]);
  useLayoutEffect(()=>{
    if(!showConfirmation)return;
    const heading=page.current?.querySelector('.claim-confirmation h1');
    window.scrollTo(0,0);
    heading?.setAttribute('tabindex','-1');
    heading?.focus({preventScroll:true});
    // A fresh claim scene already runs its own opening wave.
    const butterfly = page.current?.querySelector('.butterfly-position[data-flight="cyan"]');
    if (butterfly && window.__startMeshWave) {
      const bounds = butterfly.getBoundingClientRect();
      window.__startMeshWave(
        Math.max(0, Math.min(window.innerWidth - 1, bounds.left + bounds.width * .65)),
        Math.max(0, Math.min(window.innerHeight - 1, bounds.top + bounds.height * .25)),
        'opening'
      );
    }
  },[showConfirmation]);
  const [fullName,setFullName]=useState(name);
  const [mobile,setMobile] = useState(phone),[dial,setDial] = useState(dialCode),[otp,setOtp] = useState('');
  useEffect(()=>{setOtp('');if(!challengeId)setDetailsStep(false);},[challengeId]);
  const {message,setMessage,busy,submit} = useSubmission();
  const changed = normaliseDesignPhone(mobile,dial) !== challengePhone || (twoStep && fullName.trim() !== name);
  const sending=working||busy;
  const verificationUnavailable='Phone verification is unavailable. Please try again later.';
  function sendOtp(event) {
    if (!event.currentTarget.form.reportValidity()) return;
    if (!normaliseDesignPhone(mobile,dial)) {setMessage('Please enter a valid mobile number.');return;}
    if (twoStep&&changed) {
      void submit(onStart,{name:fullName,phone:mobile,country:dial},verificationUnavailable);
      return;
    }
    if (changed) {
      void submit(onClaim,{mobile,dialCode:dial,otp:''},verificationUnavailable);
    } else {
      void submit(onResend,{},'Please request another code later.');
    }
  }
  function saveDetails(event) {
    event.preventDefault();
    const fields=event.currentTarget.elements;
    void submit(onClaim,{mobile,dialCode:dial,email:fields.email.value,terms:fields.terms.checked,updates:fields.updates.checked},verificationUnavailable);
  }
  function save(event) {
    event.preventDefault();
    if (changed) {setMessage('Send an OTP to verify your mobile number first.');return;}
    if (!/^\d{6}$/.test(otp)) {setMessage('Please enter the six-digit code.');return;}
    void submit(async values=>{
      const result=await onClaim(values);
      if(twoStep&&!result?.existingMember){
        if(window.matchMedia('(prefers-reduced-motion:reduce)').matches)setDetailsStep(true);
        else setLeaving(true);
      }
    },{mobile,dialCode:dial,otp,verifyOnly:twoStep},verificationUnavailable);
  }
  return <PageShell scene="claim" initialize={initialize} title={pageTitle}>
    <ClaimMesh />
    <main ref={page} className={"page text-layer"+(leaving||confirmation&&!showConfirmation?" claim-copy-leaving":"")}>
      <ClaimArtwork />
      {!confirmation && (onBack || onClose) && <div className="claim-navigation">
        {onBack && <button className="claim-back" type="button" onClick={onBack} disabled={working}>← Back</button>}
        {onClose && <button type="button" className="auth-flow-close" aria-label="Close account form" onClick={onClose}>×</button>}
      </div>}
      <header className="brand"><span className="wordmark">{showConfirmation?'SO/ SAVED':result?'MEMBERSHIP':'THE SO/ COLLECTIVE'}</span></header>
      <section aria-label={showConfirmation?"Your saved SO/ COINS":detailsStep?"Confirm your details":"Claim your reward — OTP verification"} className={"content"+(showConfirmation?" claim-confirmation":detailsStep?" claim-details":"")} inert={leaving||confirmation&&!showConfirmation?true:undefined}>
        {showConfirmation?confirmation:detailsStep?<>
          <h1 ref={detailsHeading} className="claim-invitation" tabIndex={-1}>Confirm your details</h1>
          <form className="claim-form" onSubmit={saveDetails}>
            <label><span className="sr-only">Email address</span><input autoComplete="email" className="field" name="email" placeholder="Email address" type="email" required maxLength={254} defaultValue={email} disabled={sending}/></label>
            <div className="claim-consents">
              <label className="consent"><input name="terms" type="checkbox" required disabled={sending}/><span>I'm 18 or older and I agree to the <a href={termsUrl||'/terms'} target="_blank" rel="noopener">Terms and Conditions</a> and <a href={privacyUrl||'/privacy'} target="_blank" rel="noopener">Privacy Policy</a>.</span></label>
              <label className="consent"><input name="updates" type="checkbox" disabled={sending}/><span>Keep me posted on new collections, drops and what's next.</span></label>
            </div>
            <div className="buttons"><button className="btn" type="submit" disabled={sending}><span>{sending?'PLEASE WAIT…':'SAVE MY SO/ COINS'}</span><Arrow /></button></div>
            <p className="feedback" role="status">{status || message}</p>
          </form>
        </>:<>
        <p className="claim-invitation">JOIN <span className="collective-name">THE SO/ COLLECTIVE</span></p>
        {result&&<p className="claim-score">{formatPoints(result.points)} SO/ COINS · {rewardMoney(result.points)} off <span className="brand-word">SO/ FACET</span> diamond jewellery</p>}
        <form className="claim-form" id="claim" noValidate onSubmit={save}>
          <label><span className="sr-only">Full name</span><input autoComplete="name" className="field" name="fullName" placeholder="Full name" value={fullName} readOnly={!twoStep} required maxLength={80} disabled={working} onChange={event=>setFullName(capitaliseName(event.target.value))} /></label>
          <div className="phone-row">
            <label className="dial-wrap"><span className="sr-only">Country code</span><select className="dial" name="dialCode" value={dial} onChange={event=>setDial(event.target.value)} disabled={working}>{countries.map(country=><option key={country.code} value={country.dial}>{country.name} ({country.dial})</option>)}</select></label>
            <label style={{flex:1,minWidth:0}}><span className="sr-only">Mobile number</span><input autoComplete="tel-national" className="field" inputMode="tel" name="mobile" placeholder="Mobile number" type="tel" required value={mobile} onChange={event=>setMobile(event.target.value)} disabled={working} /></label>
          </div>
          <div className="claim-otp-row">
            <label className="otp-field"><span className="sr-only">Six-digit confirmation code</span><input id="final-otp" autoComplete="one-time-code" className="field" inputMode="numeric" maxLength={6} name="otp" placeholder="OTP" value={otp} onChange={event=>setOtp(event.target.value.replace(/\D/g,''))} disabled={working||changed} /></label>
            <button className="btn claim-send-otp" type="button" disabled={sending||resendSeconds>0} onClick={sendOtp} aria-describedby={twoStep?"claim-otp-consent":undefined}>{resendSeconds>0?'Resend in '+resendSeconds+'s':changed?'Send OTP':'Resend OTP'}</button>
          </div>
          {twoStep&&<p id="claim-otp-consent" className="help">By requesting an OTP, you agree to receive a verification code by WhatsApp or SMS.</p>}
          <p className="signin">Already saved your <span className="inline-coins">SO/ COINS</span>? {onSignIn&&<button className="claim-sign-in" type="button" disabled={working} onClick={onSignIn}>Sign in</button>}</p>
          <div className="buttons"><button className="btn" type="submit" disabled={sending||changed}><span>{sending?'PLEASE WAIT…':'SAVE MY SO/ COINS'}</span><Arrow /></button></div>
          <p aria-live="polite" className="feedback" id="feedback" role="status">{status || message}</p>
        </form>
        </>}
      </section>
    </main>
  </PageShell>;
}
