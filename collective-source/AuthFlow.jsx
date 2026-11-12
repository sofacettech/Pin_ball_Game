import React,{useEffect,useId,useRef,useState} from 'react';
import AccountPage from './AccountPage.jsx';
import ClaimPage from './ClaimPage.jsx';
import {RewardNoticeArtwork} from './artwork/RewardNoticeArtwork.jsx';
import {request,pendingResult} from '../membership-source/src/api.js';
import {phoneParts} from '../membership-source/src/phone.js';
import {normaliseDesignPhone,registrationDetails,registrationPayload} from './auth-values.js';
import {leaveCopy,rewardMoney,formatPoints,leaderboardName,validPlayerName} from '../game-source/src/player-copy.ts';
import './flow.css';
import './reward-notice.css';
import {brandText} from '../shared/brand-react.jsx';
import {accountNavigationHref} from '../shared/account-session.js';
import {readScreenData,writeScreenData,setScreenRoute,registrationScreenRoute} from '../site-routes.js';

const embedded=window.parent!==window&&window.name!=='sofacet-game-info';
const post=data=>{if(embedded)window.parent.postMessage(data,location.origin);};
export const joinPageTitle='SO/ FACET — Join THE SO/ COLLECTIVE';
export function SavedConfirmation({saved,status='',onReplay}) {
  const shareDialog=useRef(null),message=useRef(null),shareTitle=useId();
  const [shareStatus,setShareStatus]=useState('');
  const title='SO/ FACET — Pinball',url='https://shopsofacet.com/game';
  const text=saved?.pointsSaved?`${leaderboardName(saved.player?.display_name)} scored ${formatPoints(saved.score)} SO/ COINS in SO/ FACET Pinball. So/ what’s yours?`:'';
  const shareText=text+'\n'+url;
  const encode=encodeURIComponent;
  async function copyScore(){
    try{await navigator.clipboard.writeText(shareText);setShareStatus('Your score was copied.');}
    catch{message.current.focus();message.current.select();setShareStatus('Copy the selected message to share it.');}
  }
  async function shareToApps(){
    try{await navigator.share({title,text,url});}
    catch(error){if(error.name!=='AbortError')setShareStatus('Choose an app here or copy your score.');}
  }
  return brandText(<section className="auth-flow-notice saved-confirmation">
    <p>{saved?.pointsSaved?'SO/ SAVED':'SO/ COINS SAVED'}</p><h1>It’s yours.</h1>
    {saved?.pointsSaved&&<p>You joined THE SO/ COLLECTIVE.</p>}
    <p>{saved?.pointsSaved?formatPoints(saved.savedPoints)+' SO/ COINS ('+rewardMoney(saved.savedPoints)+' off) are saved for SO/ FACET diamond jewellery.':'You joined THE SO/ COLLECTIVE. Play a round to earn SO/ COINS.'}</p>
    {saved?.pointsSaved&&<p>Use your SO/ COINS from our launch. <a href="/terms" target="_blank" rel="noopener">Terms apply.</a></p>}
    {status&&<p role="status">{status}</p>}
    <div className="auth-flow-actions">
      <button type="button" onClick={onReplay??(()=>window.top.location.assign('/game'))}>{saved?.pointsSaved?'Play again':'Play pinball'}</button>
      {saved?.pointsSaved&&<button type="button" aria-haspopup="dialog" onClick={()=>{setShareStatus('');shareDialog.current.showModal();}}>Share my score</button>}
      {saved?.pointsSaved&&<button type="button" onClick={()=>window.top.location.assign('/notify')}>NOTIFY ME</button>}
    </div>
    {saved?.pointsSaved&&<dialog className="share-score" ref={shareDialog} aria-labelledby={shareTitle} onKeyDown={event=>{if(event.key==='Escape')event.stopPropagation();}}>
      <h2 id={shareTitle}>Share my score</h2>
      <textarea ref={message} aria-label="Score message" rows={4} readOnly value={shareText}/>
      <div className="share-score-actions">
        <a href={'https://wa.me/?text='+encode(shareText)} target="_blank" rel="noopener noreferrer">WhatsApp</a>
        <a href={'https://t.me/share/url?url='+encode(url)+'&text='+encode(text)} target="_blank" rel="noopener noreferrer">Telegram</a>
        <a href={'https://twitter.com/intent/tweet?text='+encode(text)+'&url='+encode(url)} target="_blank" rel="noopener noreferrer">X</a>
        <a href={'mailto:?subject='+encode(title)+'&body='+encode(shareText)} target="_top">Email</a>
        {typeof navigator.share==='function'&&<button type="button" onClick={shareToApps}>More apps</button>}
        <button type="button" onClick={copyScore}>Copy my score</button>
        <button type="button" onClick={()=>shareDialog.current.close()}>Done</button>
      </div>
      {shareStatus&&<p role="status">{shareStatus}</p>}
    </dialog>}
  </section>);
}
export default function AuthFlow({pageTitle,pointsContext=false,initialTab='create',initialEmail='',checkMembership=true,forceVerification=false,claimFirst=false,onComplete,onBack,firstCut=false}) {
  const fromAccount=useRef(new URLSearchParams(location.search).get('from')==='account');
  const [tab,setTab]=useState(initialTab),[step,setStep]=useState(claimFirst&&!forceVerification?'claim':'identity'),[memberCheck,setMemberCheck]=useState(checkMembership?'checking':'guest');
  const restoredResult=useRef(!embedded&&claimFirst?pendingResult(readScreenData('reward')):null);
  const restoredSaved=useRef(location.pathname==='/coins-saved'?readScreenData('saved'):null);
  const [defaults,setDefaults]=useState({email:initialEmail}),[details,setDetails]=useState(null),[pending,setPending]=useState(restoredResult.current),[saved,setSaved]=useState(restoredSaved.current);
  const [challenge,setChallenge]=useState(null),[status,setStatus]=useState(''),[busy,setBusy]=useState(false),[config,setConfig]=useState(null),[resendAt,setResendAt]=useState(0),[seconds,setSeconds]=useState(0),[exit,setExit]=useState(null);
  const pendingRef=useRef(restoredResult.current),savedRef=useRef(false),lock=useRef(false),controller=useRef(null),proof=useRef(null),mounted=useRef(true),completeRef=useRef(onComplete),backRef=useRef(onBack),exitRef=useRef(null);
  useEffect(()=>{
    if(restoredSaved.current?.pointsSaved===true){setStep('success');setMemberCheck('guest');savedRef.current=true;}
  },[]);
  useEffect(()=>{
    if(memberCheck!=='guest')return;
    const route=registrationScreenRoute({step,tab,challenge:claimFirst&&step==='claim'?null:challenge,exit,fromAccount:fromAccount.current});
    if(route){
      setScreenRoute(route);
      window.dispatchEvent(new Event('sofacet:registration-route'));
    }
  },[memberCheck,step,tab,challenge,exit,claimFirst]);
  const exitHeading=useRef(null);
  useEffect(()=>{if(exit)exitHeading.current?.focus({preventScroll:true});},[exit]);
  completeRef.current=onComplete;backRef.current=onBack;
  const unsaved=()=>!!pendingRef.current&&pendingRef.current.points>=10&&!savedRef.current;
  function leave(target='/') {
    if(lock.current){setStatus('Please wait for the current request to finish.');return;}
    if(unsaved()){setExit('confirm');return;}
    if(typeof target==='function')target();else if(backRef.current&&target==='/')backRef.current();else if(embedded&&target==='/')post({type:'contest-registration:close'});else window.top.location.assign(target);
  }
  exitRef.current=(target,escape=false)=>{if(escape&&exit==='confirm'){setExit(null);return;}leave(target);};
  useEffect(()=>{
    const abort=new AbortController();mounted.current=true;
    request('/api/membership/config',undefined,abort.signal).then(setConfig).catch(error=>{if(!abort.signal.aborted)setStatus(error.message);});
    if(checkMembership&&!restoredSaved.current?.pointsSaved)request('/api/account/session',undefined,abort.signal).then(session=>{
      if(typeof session.signedIn!=='boolean')throw Error('Your account could not be checked.');
      if(session.signedIn&&!forceVerification){
        setMemberCheck('member');
        if(embedded)post({type:'sofacet:membership-existing'});
        else location.replace(accountNavigationHref('/notify'));
      }
      else {setMemberCheck('guest');if(forceVerification){setTab('registered');setStatus('Please verify your phone again to save your SO/ COINS.');}}
    }).catch(error=>{if(!abort.signal.aborted){setMemberCheck('error');setStatus(error.message);}});
    const receive=event=>{
      if(!embedded||event.origin!==location.origin||event.source!==window.parent)return;
      if(event.data?.type==='sofacet:pending-reward'){const result=pendingResult(event.data.result);if(result){pendingRef.current=result;setPending(result);}}
      if(event.data?.type==='sofacet:request-exit')exitRef.current(()=>post({type:'contest-registration:close'}),true);
    };
    const navigate=event=>{
      if(!unsaved()||event.defaultPrevented||event.button!==0||event.ctrlKey||event.metaKey||event.altKey||event.shiftKey)return;
      const link=event.target instanceof Element?event.target.closest('a[href]'):null;
      if(!link||link.target==='_blank'||link.hasAttribute('download'))return;
      const url=new URL(link.href,location.href);if(!['http:','https:'].includes(url.protocol)||url.href===location.href)return;
      event.preventDefault();exitRef.current(url.href);
    };
    const escape=event=>{if(event.key!=='Escape'||event.defaultPrevented||document.body.hasAttribute('data-menu-open'))return;if(claimFirst&&embedded&&pendingRef.current){post({type:'contest-registration:close',returnToScore:true});return;}exitRef.current(embedded?()=>post({type:'contest-registration:close'}):'/',true);};
    window.addEventListener('message',receive);document.addEventListener('click',navigate,true);document.addEventListener('keydown',escape);
    Object.defineProperty(window,'sofacetPendingReward',{get:()=>pendingRef.current,configurable:true});
    post({type:'sofacet:membership-ready'});
    return()=>{mounted.current=false;abort.abort();controller.current?.abort();window.removeEventListener('message',receive);document.removeEventListener('click',navigate,true);document.removeEventListener('keydown',escape);delete window.sofacetPendingReward;};
  },[checkMembership,forceVerification,claimFirst]);
  useEffect(()=>{const tick=()=>setSeconds(Math.max(0,Math.ceil((resendAt-Date.now())/1000)));tick();const timer=setInterval(tick,1000);return()=>clearInterval(timer);},[resendAt]);
  async function perform(action) {
    if(lock.current)throw Error('Please wait for the current request to finish.');
    lock.current=true;setBusy(true);setStatus('');controller.current=new AbortController();
    try{return await action(controller.current.signal);}
    catch(error){if(mounted.current&&!controller.current.signal.aborted){setStatus(error.message||'Please try again.');if(Number.isFinite(error.retryAfter))setResendAt(Date.now()+error.retryAfter*1000);if(['invalid_token','rewards_verification_required'].includes(error.code)){proof.current=null;setChallenge(null);if(!claimFirst||step!=='claim'){setStep('identity');setTab('registered');}}}throw error;}
    finally{lock.current=false;if(mounted.current)setBusy(false);}
  }
  async function sendCode(kind,phoneNumber,{name,consent}={},signal) {
    if(!phoneNumber)throw Error('Please enter a valid mobile number.');
    if(seconds>0)throw Error('Please wait '+seconds+' seconds before requesting another code.');
    if(kind==='signup'&&(!config?.policies?.terms||!config?.policies?.privacy))throw Error('Account terms are not available yet. Please try again later.');
    proof.current=null;
    const sent=await request(kind==='signin'?'/api/account/otp/request':'/api/membership/otp/request',kind==='signin'?{phoneNumber}:{phoneNumber,name,consent},signal);
    if(sent.success!==true||typeof sent.challengeId!=='string'||!Number.isFinite(sent.expiresIn)||sent.expiresIn<=0)throw Error('Your code could not be sent. Please try again.');
    setChallenge({id:sent.challengeId,phoneNumber,kind,expiresAt:Date.now()+sent.expiresIn*1000,channel:sent.deliveryChannel});
    setResendAt(Date.now()+Math.max(60,sent.resendAfter||60)*1000);
    const message='Code sent by '+(sent.deliveryChannel==='whatsapp'?'WhatsApp':'SMS')+'. Enter it to continue.';setStatus(message);return {message};
  }
  async function complete(value) {
    if(value.player?.member!==true)throw Error('Your account could not be confirmed.');
    const score=pendingRef.current?.points??value.player.best_score??value.savedPoints;
    const confirmation={...value,score};
    savedRef.current=true;pendingRef.current=null;setSaved(confirmation);setStep('success');setResendAt(0);
    writeScreenData('reward',null);if(value.pointsSaved)writeScreenData('saved',{pointsSaved:true,savedPoints:value.savedPoints,score,player:{member:true,display_name:value.player.display_name}});
    if(embedded)post({type:'contest-registration:complete',player:value.player});
    else if(completeRef.current)await completeRef.current(value);
    else if(!value.pointsSaved)location.replace(accountNavigationHref(firstCut&&challenge?.kind==='signup'?'/confirmation':'/notify'));
  }
  const createAccount=values=>perform(async signal=>{
    const profile=registrationDetails(values);
    if(!pendingRef.current&&!profile.marketingConsent)throw Error("Please opt in to updates to join THE SO/ COLLECTIVE.");
    setDefaults(values);setDetails(profile);
    if(challenge?.kind==='signup'&&challenge.expiresAt>Date.now()&&details?.name===profile.name&&challenge.phoneNumber===profile.phoneNumber){setStep('claim');setStatus('Enter the code already sent to your mobile number.');return;}
    await sendCode('signup',profile.phoneNumber,{name:profile.name,consent:profile.termsAccepted},signal);setStep('claim');
  });
  const startClaim=values=>perform(async signal=>{
    const name=values.name.trim();
    if(!validPlayerName(name))throw Error('Please enter your full name using letters.');
    const phoneNumber=normaliseDesignPhone(values.phone,values.country);
    const result=await sendCode('signup',phoneNumber,{name,consent:true},signal);
    setDetails({name,phoneNumber});
    setDefaults(current=>({...current,...values}));
    return result;
  });
  const requestSignIn=values=>perform(signal=>sendCode('signin',normaliseDesignPhone(values.phone),undefined,signal));
  const signIn=values=>perform(async signal=>{
    const phoneNumber=normaliseDesignPhone(values.phone);
    if(pendingRef.current&&!pendingRef.current.gameId)throw Error('This game could not connect for verification. Play another round to save SO/ COINS.');
    if(!challenge||challenge.kind!=='signin'||challenge.phoneNumber!==phoneNumber)throw Error('Generate a code for this mobile number first.');
    if(!/^\d{6}$/.test(values.otp||''))throw Error('Enter the six-digit code.');
    if(!proof.current){if(Date.now()>=challenge.expiresAt)throw Error('This code expired. Please request another code.');const response=await request('/api/account/otp/verify',{phoneNumber,otp:values.otp,challengeId:challenge.id},signal);if(response.verified!==true)throw Error('Your code could not be verified.');proof.current='signed-in';}
    const player=await request('/api/player',undefined,signal);
    const reward=pendingRef.current?await request('/api/membership/rewards',{gameId:pendingRef.current.gameId},signal):{pointsSaved:false,savedPoints:0,remainingPoints:0};
    if(pendingRef.current&&reward.pointsSaved!==true)throw Error('Your SO/ COINS have not been confirmed as saved.');
    await complete({...reward,player});
  });
  const confirm=values=>perform(async signal=>{
    if(!details||!challenge||challenge.kind!=='signup')throw Error('Please return to your details and request a code.');
    const phoneNumber=normaliseDesignPhone(values.mobile,values.dialCode);
    if(phoneNumber!==challenge.phoneNumber){if(claimFirst)throw Error('Request an OTP for this mobile number first.');const updated={...details,phoneNumber};setDetails(updated);setDefaults(current=>({...current,phone:values.mobile,country:values.dialCode}));return sendCode('signup',phoneNumber,{name:updated.name,consent:updated.termsAccepted},signal);}
    if(values.otp!==undefined&&!/^\d{6}$/.test(values.otp))throw Error('Enter the six-digit code.');
    if(pendingRef.current&&!pendingRef.current.gameId)throw Error('This game could not connect for verification. Play another round to save SO/ COINS.');
    let token=proof.current;
    if(!token){if(!values.otp||Date.now()>=challenge.expiresAt)throw Error('This code expired. Please request another code.');const verified=await request('/api/membership/otp/verify',{phoneNumber,otp:values.otp,challengeId:challenge.id},signal);if(verified.verified!==true||typeof verified.verificationToken!=='string')throw Error('Your code could not be verified.');token=verified.verificationToken;proof.current=token;}
    if(values.verifyOnly)return;
    const profile=claimFirst?registrationDetails({name:details.name,phone:values.mobile,country:values.dialCode,email:values.email,terms:values.terms,updates:values.updates}):details;
    const response=await request('/api/membership',registrationPayload({...profile,phoneNumber},token,pendingRef.current?.gameId),signal);
    if(response.success!==true||response.player?.member!==true||pendingRef.current&&response.pointsSaved!==true||!Number.isSafeInteger(response.savedPoints)||response.savedPoints<0)throw Error('Your account and SO/ COINS have not been confirmed as saved. Please try again.');
    await complete(response);
  });
  const resend=()=>perform(signal=>sendCode('signup',challenge.phoneNumber,{name:details.name,consent:claimFirst||details.termsAccepted},signal));
  function switchTab(value){setTab(value);setStatus('');proof.current=null;setChallenge(null);if(claimFirst&&value==='create')setStep('claim');}
  const goBack=()=>{if(claimFirst&&embedded){post({type:'contest-registration:close',returnToScore:true});return;}if(step==='claim'){setStep('identity');setStatus('');return;}leave('/');};
  const replay=()=>{savedRef.current=true;pendingRef.current=null;if(embedded)post({type:'sofacet:membership-replay'});else window.top.location.assign('/game');};
  if(exit){
    const copy=leaveCopy(pending?.points||0);
    return brandText(<section className="auth-flow-notice reward-notice">
      <RewardNoticeArtwork/>
      <p>BEFORE YOU GO</p>
      <h1 ref={exitHeading} tabIndex={-1}>{copy.title}</h1>
      <p>{copy.support}</p>
      <div className="auth-flow-actions reward-notice-actions">
        <button onClick={()=>setExit(null)}>Save my SO/ COINS</button>
        <button onClick={()=>{
          pendingRef.current=null;
          savedRef.current=true;
          writeScreenData('reward',null);
          post({type:'sofacet:reward-discarded'});
          window.top.location.assign('/notify');
        }}>Leave anyway</button>
      </div>
    </section>);
  }
  if(memberCheck!=='guest')return brandText(<section className="auth-flow-notice" role="status"><p>{memberCheck==='error'?"We couldn't load your SO/ COINS. Please try again.":memberCheck==='member'?'Opening your account…':'Checking your SO/ COINS…'}</p>{status&&memberCheck!=='error'&&<p>{status}</p>}{memberCheck==='error'&&<button onClick={()=>location.reload()}>Try again</button>}</section>);
  const inlineSaved=step==='success'&&saved?.pointsSaved;
  const confirmation=step==='success'?<SavedConfirmation saved={saved} status={status} onReplay={replay}/>:null;
  if(confirmation&&!inlineSaved)return confirmation;
  const close=embedded&&!inlineSaved?()=>leave('/'):undefined;
  return <>
    {close&&step!=='claim'&&<button type="button" className="auth-flow-close" aria-label="Close account form" onClick={close}>×</button>}
    {embedded&&claimFirst&&step==='identity'&&<button type="button" className="auth-flow-back" onClick={goBack}>← Back</button>}
    {!embedded&&onBack&&step==='identity'&&<button type="button" className="auth-flow-back" onClick={()=>leave('/')}>← Back</button>}
    {step==='claim'||inlineSaved?<ClaimPage confirmation={inlineSaved?confirmation:null} pageTitle={pageTitle} result={inlineSaved?{points:saved.score}:pending} challengeId={challenge?.id} name={details?.name||defaults.name} phone={phoneParts(challenge?.phoneNumber||'').nationalNumber||defaults.phone||''} dialCode={defaults.country||'+91'} challengePhone={challenge?.phoneNumber} twoStep={claimFirst} email={defaults.email} onStart={startClaim} termsUrl={config?.policies?.terms} privacyUrl={config?.policies?.privacy} onClaim={confirm} onResend={resend} onBack={goBack} onClose={close} onSignIn={()=>{setStep('identity');switchTab('registered');}} status={status} resendSeconds={seconds} working={busy}/>:<AccountPage pageTitle={step==='identity'&&tab==='create'?joinPageTitle:pageTitle} pointsContext={pointsContext} updatesRequired={!pending} initialTab={initialTab} activeTab={tab} onTabChange={switchTab} defaults={defaults} onLogin={signIn} onRequestOtp={requestSignIn} onCreateAccount={createAccount} status={status} codeRequested={challenge?.kind==='signin'} working={busy} resendSeconds={seconds} termsUrl={config?.policies?.terms} privacyUrl={config?.policies?.privacy}/>}
  </>;
}
