import React, {useState} from 'react';
import PageShell from './PageShell.jsx';
import {ClaimArtwork, ClaimMesh} from './artwork/ClaimArtwork.jsx';
import initialize from './scenes/claim.js';
import {countries} from '../membership-source/src/phone.js';
import {formatPoints,rewardMoney} from '../game-source/src/player-copy.ts';
import {Arrow} from './icons.jsx';
import {normaliseDesignPhone} from './auth-values.js';
import {useSubmission} from './form-actions.js';

export default function ClaimPage({result,name = '',phone = '',dialCode = '+91',challengePhone,onClaim,onResend,onBack,onSignIn,status = '',resendSeconds = 0,working = false}) {
  const [mobile,setMobile] = useState(phone),[dial,setDial] = useState(dialCode),[otp,setOtp] = useState('');
  const {message,setMessage,busy,submit} = useSubmission();
  const changed = normaliseDesignPhone(mobile,dial) !== challengePhone;
  function save(event) {
    event.preventDefault();
    if (!normaliseDesignPhone(mobile,dial)) {setMessage('Please enter a valid mobile number.');return;}
    if (!changed && !/^\d{6}$/.test(otp)) {setMessage('Please enter the six-digit code.');return;}
    void submit(onClaim,{fullName:name,mobile,dialCode:dial,otp},'Phone verification is unavailable. Please try again later.');
  }
  return <PageShell scene="claim" initialize={initialize} title="Claim your reward | SO/ FACET">
    <ClaimMesh />
    <main className="page text-layer">
      <ClaimArtwork />
      {onBack && <button className="claim-back" type="button" onClick={onBack} disabled={working}>← Back</button>}
      <header className="brand"><span className="wordmark">{result?'GAME COMPLETE':'THE FIRST CUT'}</span></header>
      <section aria-label="Claim your reward — OTP verification" className="content">
        <p className="claim-invitation">Join “THE FIRST CUT”.</p>
        {result&&<p className="claim-score">{formatPoints(result.points)} pts · {rewardMoney(result.points)} off <span className="brand-word">SO/ FACET</span> diamond jewellery</p>}
        <form className="claim-form" id="claim" noValidate onSubmit={save}>
          <label><span className="sr-only">Full name</span><input autoComplete="name" className="field" name="fullName" placeholder="Full name" value={name} readOnly /></label>
          <div className="phone-row">
            <label className="dial-wrap"><span className="sr-only">Country code</span><select className="dial" name="dialCode" value={dial} onChange={event=>setDial(event.target.value)} disabled={working}>{countries.map(country=><option key={country.code} value={country.dial}>{country.name} ({country.dial})</option>)}</select></label>
            <label style={{flex:1,minWidth:0}}><span className="sr-only">Mobile number</span><input autoComplete="tel-national" className="field" inputMode="tel" name="mobile" placeholder="Mobile number" type="tel" value={mobile} onChange={event=>setMobile(event.target.value)} disabled={working} /></label>
          </div>
          <label className="otp-field"><span className="sr-only">Six-digit confirmation code</span><input id="final-otp" autoComplete="one-time-code" className="field" inputMode="numeric" maxLength={6} name="otp" placeholder="OTP" value={otp} onChange={event=>setOtp(event.target.value.replace(/\D/g,''))} disabled={working} /></label>
          <p className="signin">Already saved your <span className="inline-coins">coins</span>? {onSignIn&&<button className="claim-sign-in" type="button" disabled={working} onClick={onSignIn}>Sign in</button>}</p>
          <p className="help">{changed?'Your number changed. Send a new code to verify it.':'Enter the code sent by WhatsApp or SMS to confirm it’s you.'}</p>
          <p className="help">Your points can be used after the launch and expire 6 months after the launch. Terms apply.</p>
          <div className="buttons"><button className="btn" type="submit" disabled={working || busy || changed && resendSeconds>0}><span>{working || busy?'PLEASE WAIT…':changed?'SEND NEW CODE':'SAVE MY COINS'}</span><Arrow /></button></div>
          <div className="claim-resend"><button type="button" disabled={working || busy || resendSeconds>0 || changed} onClick={()=>void submit(onResend,{},'Please request another code later.')}>{resendSeconds>0?'Resend code in '+resendSeconds+'s':'Resend code'}</button></div>
          <p aria-live="polite" className="feedback" id="feedback" role="status">{status || message}</p>
        </form>
      </section>
    </main>
  </PageShell>;
}
