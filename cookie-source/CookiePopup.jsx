import React, {useLayoutEffect, useRef, useState} from 'react';

const policy='/privacy#privacy-9-cookies-pixels-and-similar-technologies';
const CloseIcon=()=> <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true"><path d="m5 5 14 14M19 5 5 19"/></svg>;

export default function CookiePopup({showNotice,settingsOpen,choice,persisted,open,close,save}){
 const dialog=useRef(null),title=useRef(null);
 const [analytics,setAnalytics]=useState(choice.analytics),[advertising,setAdvertising]=useState(choice.advertising);
 useLayoutEffect(()=>{
  if(settingsOpen){
   setAnalytics(choice.analytics);setAdvertising(choice.advertising);
   if(!dialog.current.open)dialog.current.showModal();
   title.current.focus({preventScroll:true});dialog.current.scrollTop=0;
  }else if(dialog.current.open)dialog.current.close();
 },[settingsOpen,choice]);
 return <>
  <section id="sf-cookie-notice" className="cookie-panel" aria-labelledby="sf-cookie-notice-title" hidden={!showNotice}>
   <h2 id="sf-cookie-notice-title">YOUR COOKIE CHOICES.</h2>
   <p className="intro">Essential cookies keep this site working. <strong>“Accept all”</strong> also allows optional cookies. <strong>“Reject optional”</strong> keeps essential cookies only. You can change your choice anytime in Cookie settings.</p>
   <a className="privacy-link" href={policy}>Privacy policy</a>
   <div className="actions">
    <button className="button" type="button" data-accept onClick={()=>save(true,true)}>Accept all</button>
    <button className="button" type="button" data-reject onClick={()=>save(false,false)}>Reject optional</button>
   </div>
   <button className="button outline settings-button" type="button" data-manage aria-controls="sf-cookie-settings" onClick={open}>Cookie settings</button>
  </section>
  <dialog ref={dialog} id="sf-cookie-settings" className="cookie-panel preferences" aria-labelledby="sf-cookie-title" aria-describedby="sf-cookie-description" onClose={close} onKeyDown={event=>event.stopPropagation()}>
   <div className="preferences-header">
    <h2 id="sf-cookie-title" tabIndex={-1} ref={title}>Cookie preferences</h2>
    <button className="icon-button" type="button" aria-label="Close cookie preferences" onClick={close}><CloseIcon/></button>
   </div>
   <p id="sf-cookie-description" className="intro">Your game and SO/ COINS work with essential cookies only.</p>
   <form onSubmit={event=>{event.preventDefault();save(analytics,advertising)}}>
    <div className="preference-row">
     <div><div className="option-name">Essential</div><p className="option-description">Game settings, sign-in and security.</p></div>
     <span className="option-status">Always on</span>
    </div>
    <div className="preference-row">
     <div><div className="option-name" id="sf-analytics-label">Analytics</div><p className="option-description" id="sf-analytics-description">Site visits and session recordings.</p></div>
     <label className="switch-control"><span className="option-status" aria-hidden="true">{analytics?'On':'Off'}</span><input name="analytics" type="checkbox" role="switch" aria-labelledby="sf-analytics-label" aria-describedby="sf-analytics-description" checked={analytics} onChange={event=>setAnalytics(event.target.checked)}/></label>
    </div>
    <div className="preference-row">
     <div><div className="option-name" id="sf-advertising-label">Advertising</div><p className="option-description" id="sf-advertising-description">Ad performance and personalised ads.</p></div>
     <label className="switch-control"><span className="option-status" aria-hidden="true">{advertising?'On':'Off'}</span><input name="advertising" type="checkbox" role="switch" aria-labelledby="sf-advertising-label" aria-describedby="sf-advertising-description" checked={advertising} onChange={event=>setAdvertising(event.target.checked)}/></label>
    </div>
    <p className="in-use-note">Analytics and advertising are not currently in use.</p>
    <div className="privacy-row"><a className="privacy-link" href={policy}>Privacy policy</a><p className="retention-note">{persisted?'Saved in this browser for 12 months.':'Your choice applies to this visit only.'}</p></div>
    <div className="actions"><button className="button outline" type="button" data-reject onClick={()=>save(false,false)}>Essential only</button><button className="button" type="submit">Save preferences</button></div>
   </form>
  </dialog>
  <p className="sr-only" role="status" aria-live="polite">{!persisted?'Your choice applies to this visit only.':''}</p>
 </>;
}
