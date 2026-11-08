import React, {useEffect,useLayoutEffect,useRef,useState} from 'react';
import PageShell from './PageShell.jsx';
import {ClaimArtwork, ClaimMesh} from './artwork/ClaimArtwork.jsx';
import initialize from './scenes/claim.js';
import {countries} from '../membership-source/src/phone.js';
import {capitaliseName,formatPoints,rewardMoney} from '../game-source/src/player-copy.ts';
import {Arrow} from './icons.jsx';
import {normaliseDesignPhone} from './auth-values.js';
import {useSubmission} from './form-actions.js';

export default function ClaimPage({pageTitle='SO/ FACET — My SO/ COINS',result,confirmation=null,name = '',phone = '',dialCode = '+91',challengePhone,collectDetails=false,email='',onStart,termsUrl,privacyUrl,onClaim,onResend,onBack,onSignIn,status = '',resendSeconds = 0,working = false}) {
  const [showConfirmation,setShowConfirmation]=useState(Boolean(confirmation));
  const page=useRef(null);
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
  },[showConfirmation]);
  const [fullName,setFullName]=useState(name),[emailAddress,setEmail]=useState(email);
  const [mobile,setMobile] = useState(phone),[dial,setDial] = useState(dialCode),[otp,setOtp] = useState('');
  const {message,setMessage,busy,submit} = useSubmission();
  const changed = normaliseDesignPhone(mobile,dial) !== challengePhone;
  function save(event) {
    event.preventDefault();
    if (collectDetails) {
      const form=event.currentTarget;if(!form.reportValidity())return;
      void submit(onStart,{name:fullName,phone:mobile,country:dial,email:emailAddress,terms:form.elements.terms.checked,updates:form.elements.updates.checked},'Phone verification is unavailable. Please try again later.');
      return;
    }
    if (!normaliseDesignPhone(mobile,dial)) {setMessage('Please enter a valid mobile number.');return;}
    if (!changed && !/^\d{6}$/.test(otp)) {setMessage('Please enter the six-digit code.');return;}
    void submit(onClaim,{fullName:name,mobile,dialCode:dial,otp},'Phone verification is unavailable. Please try again later.');
  }
  return <PageShell scene="claim" initialize={initialize} title={pageTitle}>
    <ClaimMesh />
    <main ref={page} className={"page text-layer"+(confirmation&&!showConfirmation?" claim-copy-leaving":"")}>
      <ClaimArtwork />
      {onBack && !confirmation && <button className="claim-back" type="button" onClick={onBack} disabled={working}>← Back</button>}
      <header className="brand"><span className="wordmark">{showConfirmation?'SO/ SAVED':result?'MEMBERSHIP':'THE FIRST CUT'}</span></header>
      <section aria-label={showConfirmation?"Your saved SO/ COINS":"Claim your reward — OTP verification"} className={"content"+(showConfirmation?" claim-confirmation":"")} inert={confirmation&&!showConfirmation?true:undefined}>
        {showConfirmation?confirmation:<>
        <p className="claim-invitation">JOIN <span className="collective-name">THE SO/ COLLECTIVE</span></p>
        {result&&<p className="claim-score">{formatPoints(result.points)} SO/ COINS · {rewardMoney(result.points)} off <span className="brand-word">SO/ FACET</span> diamond jewellery</p>}
        <form className="claim-form" id="claim" noValidate onSubmit={save}>
          <label><span className="sr-only">Full name</span><input autoComplete="name" className="field" name="fullName" placeholder="Full name" value={fullName} readOnly={!collectDetails} required maxLength={80} disabled={working} onChange={event=>setFullName(capitaliseName(event.target.value))} /></label>
          <div className="phone-row">
            <label className="dial-wrap"><span className="sr-only">Country code</span><select className="dial" name="dialCode" value={dial} onChange={event=>setDial(event.target.value)} disabled={working}>{countries.map(country=><option key={country.code} value={country.dial}>{country.name} ({country.dial})</option>)}</select></label>
            <label style={{flex:1,minWidth:0}}><span className="sr-only">Mobile number</span><input autoComplete="tel-national" className="field" inputMode="tel" name="mobile" placeholder="Mobile number" type="tel" required value={mobile} onChange={event=>setMobile(event.target.value)} disabled={working} /></label>
          </div>
          {collectDetails&&<label className="claim-email"><span className="sr-only">Email address</span><input autoComplete="email" className="field" name="email" placeholder="Email address" type="email" required maxLength={254} value={emailAddress} onChange={event=>setEmail(event.target.value)} disabled={working}/></label>}
          <label className="otp-field"><span className="sr-only">Six-digit confirmation code</span><input id="final-otp" autoComplete="one-time-code" className="field" inputMode="numeric" maxLength={6} name="otp" placeholder="OTP" value={otp} onChange={event=>setOtp(event.target.value.replace(/\D/g,''))} disabled={working||collectDetails} /></label>
          <p className="signin">Already saved your <span className="inline-coins">SO/ COINS</span>? {onSignIn&&<button className="claim-sign-in" type="button" disabled={working} onClick={onSignIn}>Sign in</button>}</p>
          <p className="help">{collectDetails?'We’ll send a code by WhatsApp or SMS to confirm it’s you.':changed?'Your number changed. Send a new code to verify it.':'Enter the code sent by WhatsApp or SMS to confirm it’s you.'}</p>
          <p className="help">Use your SO/ COINS from our launch in December. They expire 6 months after it. Terms apply.</p>
          {collectDetails&&<div className="claim-consents">
            <label className="consent"><input name="terms" type="checkbox" required disabled={working}/><span>I'm 18 or older and I agree to the <a href={termsUrl||'/terms'} target="_blank" rel="noopener">Terms and Conditions</a> and <a href={privacyUrl||'/privacy'} target="_blank" rel="noopener">Privacy Policy</a>, and I agree to receive a verification code.</span></label>
            <label className="consent"><input name="updates" type="checkbox" disabled={working}/><span>Send me <span className="brand-word">SO/ FACET</span> news and launch updates.</span></label>
          </div>}
          <div className="buttons"><button className="btn" type="submit" disabled={working || busy || (!collectDetails&&changed) && resendSeconds>0}><span>{working || busy?'PLEASE WAIT…':!collectDetails&&changed?'SEND NEW CODE':'SAVE MY SO/ COINS'}</span><Arrow /></button></div>
          {!collectDetails&&<div className="claim-resend"><button type="button" disabled={working || busy || resendSeconds>0 || changed} onClick={()=>void submit(onResend,{},'Please request another code later.')}>{resendSeconds>0?'Resend code in '+resendSeconds+'s':'Resend code'}</button></div>}
          <p aria-live="polite" className="feedback" id="feedback" role="status">{status || message}</p>
        </form>
        </>}
      </section>
    </main>
  </PageShell>;
}
