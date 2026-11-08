import React,{useEffect,useId,useRef,useState} from 'react';
import AccountPage from './AccountPage.jsx';
import ClaimPage from './ClaimPage.jsx';
import {RewardNoticeArtwork} from './artwork/RewardNoticeArtwork.jsx';
import {request,pendingResult} from '../membership-source/src/api.js';
import {phoneParts} from '../membership-source/src/phone.js';
import {normaliseDesignPhone,registrationDetails,registrationPayload} from './auth-values.js';
import {leaveCopy,exitCopy,rewardMoney,formatPoints,leaderboardName} from '../game-source/src/player-copy.ts';
import './flow.css';
import './reward-notice.css';
import {brandText} from '../shared/brand-react.jsx';
import {accountNavigationHref} from '../shared/account-session.js';

const embedded=window.parent!==window&&window.name!=='sofacet-game-info';
const post=data=>{if(embedded)window.parent.postMessage(data,location.origin);};
export function SavedConfirmation({saved,status='',onReplay}) {
  const shareDialog=useRef(null),message=useRef(null),shareTitle=useId();
  const [shareStatus,setShareStatus]=useState('');
  const title='SO/ FACET — Pinball',url='https://shopsofacet.com/play.html';
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
    {saved?.pointsSaved&&<p>You made “THE FIRST CUT”.</p>}
    <p>{saved?.pointsSaved?formatPoints(saved.savedPoints)+' SO/ COINS ('+rewardMoney(saved.savedPoints)+' off) are saved for SO/ FACET diamond jewellery.':'You made “THE FIRST CUT”. Play a round to earn SO/ COINS.'}</p>
    {saved?.pointsSaved&&<p>Use your SO/ COINS from our launch in December. They expire 6 months after it. <a href="/terms.html" target="_blank" rel="noopener">Terms apply.</a></p>}
    {status&&<p role="status">{status}</p>}
    <div className="auth-flow-actions">
      <button type="button" onClick={onReplay??(()=>window.top.location.assign('/play.html'))}>{saved?.pointsSaved?'Play again':'Play pinball'}</button>
      {saved?.pointsSaved&&<button type="button" aria-haspopup="dialog" onClick={()=>{setShareStatus('');shareDialog.current.showModal();}}>Share my score</button>}
      <a href={accountNavigationHref('/account.html')} target="_top" onClick={event=>{if(embedded&&!event.metaKey&&!event.ctrlKey&&!event.shiftKey&&!event.altKey){event.preventDefault();post({type:'sofacet:visit-saved-account'});}}}>My SO/ COINS</a>
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
  const [tab,setTab]=useState(initialTab),[step,setStep]=useState(claimFirst&&!forceVerification?'claim':'identity'),[memberCheck,setMemberCheck]=useState(checkMembership?'checking':'guest');
  const [defaults,setDefaults]=useState({email:initialEmail}),[details,setDetails]=useState(null),[pending,setPending]=useState(null),[saved,setSaved]=useState(null);
  const [challenge,setChallenge]=useState(null),[status,setStatus]=useState(''),[busy,setBusy]=useState(false),[config,setConfig]=useState(null),[resendAt,setResendAt]=useState(0),[seconds,setSeconds]=useState(0),[exit,setExit]=useState(null);
  const pendingRef=useRef(null),savedRef=useRef(false),lock=useRef(false),controller=useRef(null),proof=useRef(null),mounted=useRef(true),destination=useRef('/'),completeRef=useRef(onComplete),backRef=useRef(onBack),exitRef=useRef(null);
  const exitHeading=useRef(null);
  useEffect(()=>{if(exit)exitHeading.current?.focus({preventScroll:true});},[exit]);
  completeRef.current=onComplete;backRef.current=onBack;
  const unsaved=()=>!!pendingRef.current&&pendingRef.current.points>=10&&!savedRef.current;
  function leave(target='/') {
    if(lock.current){setStatus('Please wait for the current request to finish.');return;}
    destination.current=target;
    if(unsaved()){setExit('confirm');return;}
    if(typeof target==='function')target();else if(backRef.current&&target==='/')backRef.current();else if(embedded&&target==='/')post({type:'contest-registration:close'});else window.top.location.assign(target);
  }
  exitRef.current=(target,escape=false)=>{if(escape&&exit==='confirm'){setExit(null);return;}leave(target);};
  useEffect(()=>{
    const abort=new AbortController();mounted.current=true;
    request('/api/membership/config',undefined,abort.signal).then(setConfig).catch(error=>{if(!abort.signal.aborted)setStatus(error.message);});
    if(checkMembership)request('/api/player',undefined,abort.signal).then(player=>{
      if(typeof player.member!=='boolean')throw Error('Your account could not be checked.');
      if(player.member&&!forceVerification){setMemberCheck('member');if(embedded)post({type:'sofacet:membership-existing'});else location.replace(accountNavigationHref('/account.html'));}
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
    const unload=event=>{if(unsaved()){event.preventDefault();event.returnValue='';}};
    const escape=event=>{if(event.key!=='Escape'||event.defaultPrevented||document.body.hasAttribute('data-menu-open'))return;if(claimFirst&&embedded&&pendingRef.current){post({type:'contest-registration:close',returnToScore:true});return;}exitRef.current(embedded?()=>post({type:'contest-registration:close'}):'/',true);};
    window.addEventListener('message',receive);window.addEventListener('beforeunload',unload);document.addEventListener('click',navigate,true);document.addEventListener('keydown',escape);
    Object.defineProperty(window,'sofacetPendingReward',{get:()=>pendingRef.current,configurable:true});
    post({type:'sofacet:membership-ready'});
    return()=>{mounted.current=false;abort.abort();controller.current?.abort();window.removeEventListener('message',receive);window.removeEventListener('beforeunload',unload);document.removeEventListener('click',navigate,true);document.removeEventListener('keydown',escape);delete window.sofacetPendingReward;};
  },[checkMembership,forceVerification,claimFirst]);
  useEffect(()=>{const tick=()=>setSeconds(Math.max(0,Math.ceil((resendAt-Date.now())/1000)));tick();const timer=setInterval(tick,1000);return()=>clearInterval(timer);},[resendAt]);
  async function perform(action) {
    if(lock.current)throw Error('Please wait for the current request to finish.');
    lock.current=true;setBusy(true);setStatus('');controller.current=new AbortController();
    try{return await action(controller.current.signal);}
    catch(error){if(mounted.current&&!controller.current.signal.aborted){setStatus(error.message||'Please try again.');if(Number.isFinite(error.retryAfter))setResendAt(Date.now()+error.retryAfter*1000);if(['invalid_token','rewards_verification_required'].includes(error.code)){proof.current=null;setChallenge(null);setStep('identity');setTab('registered');}}throw error;}
    finally{lock.current=false;if(mounted.current)setBusy(false);}
  }
  async function sendCode(kind,phoneNumber,profile,signal) {
    if(!phoneNumber)throw Error('Please enter a valid mobile number.');
    if(seconds>0)throw Error('Please wait '+seconds+' seconds before requesting another code.');
    if(kind==='signup'&&(!config?.policies?.terms||!config?.policies?.privacy))throw Error('Account terms are not available yet. Please try again later.');
    proof.current=null;
    const sent=await request(kind==='signin'?'/api/account/otp/request':'/api/membership/otp/request',kind==='signin'?{phoneNumber}:{phoneNumber,name:profile.name,consent:profile.termsAccepted},signal);
    if(sent.success!==true||typeof sent.challengeId!=='string'||!Number.isFinite(sent.expiresIn)||sent.expiresIn<=0)throw Error('Your code could not be sent. Please try again.');
    setChallenge({id:sent.challengeId,phoneNumber,kind,expiresAt:Date.now()+sent.expiresIn*1000,channel:sent.deliveryChannel});
    setResendAt(Date.now()+Math.max(60,sent.resendAfter||60)*1000);
    const message='Code sent by '+(sent.deliveryChannel==='whatsapp'?'WhatsApp':'SMS')+'. Enter it to continue.';setStatus(message);return {message};
  }
  async function complete(value) {
    if(value.player?.member!==true)throw Error('Your account could not be confirmed.');
    const score=pendingRef.current?.points??value.player.best_score??value.savedPoints;
    savedRef.current=true;pendingRef.current=null;setSaved({...value,score});setStep('success');setResendAt(0);
    if(embedded)post({type:'contest-registration:complete',player:value.player});
    else if(completeRef.current)await completeRef.current(value);
    else location.replace(accountNavigationHref(firstCut?'/first-cuts-confirmation.html':'/account.html'));
  }
  const createAccount=values=>perform(async signal=>{
    const profile=registrationDetails(values);setDefaults(values);setDetails(profile);
    if(challenge?.kind==='signup'&&challenge.expiresAt>Date.now()&&details?.name===profile.name&&challenge.phoneNumber===profile.phoneNumber){setStep('claim');setStatus('Enter the code already sent to your mobile number.');return;}
    await sendCode('signup',profile.phoneNumber,profile,signal);setStep('claim');
  });
  const requestSignIn=values=>perform(signal=>sendCode('signin',normaliseDesignPhone(values.phone),null,signal));
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
    if(phoneNumber!==challenge.phoneNumber){const updated={...details,phoneNumber};setDetails(updated);setDefaults(current=>({...current,phone:values.mobile,country:values.dialCode}));return sendCode('signup',phoneNumber,updated,signal);}
    if(!/^\d{6}$/.test(values.otp||''))throw Error('Enter the six-digit code.');
    if(pendingRef.current&&!pendingRef.current.gameId)throw Error('This game could not connect for verification. Play another round to save SO/ COINS.');
    let token=proof.current;
    if(!token){if(Date.now()>=challenge.expiresAt)throw Error('This code expired. Please request another code.');const verified=await request('/api/membership/otp/verify',{phoneNumber,otp:values.otp,challengeId:challenge.id},signal);if(verified.verified!==true||typeof verified.verificationToken!=='string')throw Error('Your code could not be verified.');token=verified.verificationToken;proof.current=token;}
    const response=await request('/api/membership',registrationPayload({...details,phoneNumber},token,pendingRef.current?.gameId),signal);
    if(response.success!==true||response.player?.member!==true||pendingRef.current&&response.pointsSaved!==true||!Number.isSafeInteger(response.savedPoints)||response.savedPoints<0)throw Error('Your account and SO/ COINS have not been confirmed as saved. Please try again.');
    await complete(response);
  });
  const resend=()=>perform(signal=>sendCode('signup',challenge.phoneNumber,details,signal));
  function switchTab(value){setTab(value);setStatus('');proof.current=null;setChallenge(null);if(claimFirst&&value==='create')setStep('claim');}
  const goBack=()=>{if(claimFirst&&embedded){post({type:'contest-registration:close',returnToScore:true});return;}if(step==='claim'){setStep('identity');setStatus('');return;}leave('/');};
  const replay=()=>{savedRef.current=true;pendingRef.current=null;if(embedded)post({type:'sofacet:membership-replay'});else window.top.location.assign('/play.html');};
  if(exit){
    const confirming=exit==='confirm',copy=confirming?leaveCopy(pending?.points||0):exitCopy;
    return brandText(<section className="auth-flow-notice reward-notice">
      <RewardNoticeArtwork key={'art-'+exit}/>
      <React.Fragment key={exit}>
        <p>{confirming?'BEFORE YOU GO':'LAUNCHING IN DECEMBER'}</p>
        <h1 ref={exitHeading} tabIndex={-1}>{copy.title}</h1>
        <p>{copy.support}</p>
        <div className="auth-flow-actions reward-notice-actions">
          {confirming?<><button onClick={()=>setExit(null)}>Save my SO/ COINS</button><button onClick={()=>{pendingRef.current=null;setPending(null);savedRef.current=true;post({type:'sofacet:reward-discarded'});setExit('left');}}>Leave anyway</button></>:<><button onClick={replay}>Play again</button><button onClick={()=>leave(destination.current)}>Back to the world</button></>}
        </div>
        {!confirming&&<><a className="auth-flow-updates" href={accountNavigationHref('/membership.html?from=collective')} target="_top">Just want updates? JOIN THE SO/ COLLECTIVE →</a><p className="auth-flow-signoff"><span className="brand-word">SO/ FACET</span>. So/ what’s yours?</p></>}
      </React.Fragment>
    </section>);
  }
  if(memberCheck!=='guest')return brandText(<section className="auth-flow-notice" role="status"><p>{memberCheck==='error'?"We couldn't load your SO/ COINS. Please try again.":memberCheck==='member'?'Opening your account…':'Checking your SO/ COINS…'}</p>{status&&memberCheck!=='error'&&<p>{status}</p>}{memberCheck==='error'&&<button onClick={()=>location.reload()}>Try again</button>}</section>);
  const inlineSaved=step==='success'&&saved?.pointsSaved&&claimFirst;
  const confirmation=step==='success'?<SavedConfirmation saved={saved} status={status} onReplay={replay}/>:null;
  if(confirmation&&!inlineSaved)return confirmation;
  return <>
    {embedded&&!inlineSaved&&<button type="button" className="auth-flow-close" aria-label="Close account form" onClick={()=>leave('/')}>×</button>}
    {embedded&&claimFirst&&step==='identity'&&<button type="button" className="auth-flow-back" onClick={goBack}>← Back</button>}
    {!embedded&&onBack&&step==='identity'&&<button type="button" className="auth-flow-back" onClick={()=>leave('/')}>← Back</button>}
    {step==='claim'||inlineSaved?<ClaimPage confirmation={inlineSaved?confirmation:null} pageTitle={pageTitle} result={inlineSaved?{points:saved.score}:pending} key={challenge?.id} name={details?.name||defaults.name} phone={phoneParts(challenge?.phoneNumber||'').nationalNumber||defaults.phone||''} dialCode={defaults.country||'+91'} challengePhone={challenge?.phoneNumber} collectDetails={claimFirst&&!challenge} email={defaults.email} onStart={createAccount} termsUrl={config?.policies?.terms} privacyUrl={config?.policies?.privacy} onClaim={confirm} onResend={resend} onBack={goBack} onSignIn={()=>{setStep('identity');switchTab('registered');}} status={status} resendSeconds={seconds} working={busy}/>:<AccountPage pageTitle={pageTitle} pointsContext={pointsContext} initialTab={initialTab} activeTab={tab} onTabChange={switchTab} defaults={defaults} onLogin={signIn} onRequestOtp={requestSignIn} onCreateAccount={createAccount} status={status} working={busy} resendSeconds={seconds} termsUrl={config?.policies?.terms} privacyUrl={config?.policies?.privacy}/>}
  </>;
}
