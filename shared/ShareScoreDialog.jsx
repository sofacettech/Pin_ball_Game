import React,{useId,useRef,useState} from 'react';
import './share-score.css';

const gameUrl='https://shopsofacet.com/game';
const number=new Intl.NumberFormat('en-IN');
const icons=['whatsapp','telegram','x','gmail'];

export default function ShareScoreDialog({score,dialogRef,onClose,sharePoints=false}){
 const titleId=useId(),manualId=useId(),editorId=useId(),manual=useRef(null);
 const defaultMessage=sharePoints?`I have ${number.format(score)} SO/ COINS with SO/ FACET. See what’s yours.`:`I scored ${number.format(score)} SO/ COINS in SO/ FACET Pinball. Think you can beat it?`;
 const [message,setMessage]=useState(defaultMessage),[draft,setDraft]=useState(defaultMessage),[editing,setEditing]=useState(false),[status,setStatus]=useState(''),[manualCopy,setManualCopy]=useState(false),[copied,setCopied]=useState(false);
 const currentMessage=(editing?draft:message).trim();
 const shareText=currentMessage.includes(gameUrl)?currentMessage:currentMessage+'\n'+gameUrl;
 const encode=encodeURIComponent;
 const destinations={
  whatsapp:'https://wa.me/?text='+encode(shareText),
  telegram:'https://t.me/share/url?url='+encode(gameUrl)+'&text='+encode(currentMessage),
  x:'https://x.com/intent/tweet?text='+encode(shareText),
  gmail:'https://mail.google.com/mail/?view=cm&fs=1&su='+encode(sharePoints?'My SO/ FACET SO/ COINS':'Think you can beat my SO/ FACET Pinball score?')+'&body='+encode(shareText)
 };
 function finishEdit(save){
  if(save){if(!draft.trim()){setStatus('Write a message before saving.');return}setMessage(draft.trim());}
  else setDraft(message);
  setEditing(false);setStatus('');
 }
 function close(){setEditing(false);setDraft(message);setStatus('');setManualCopy(false);setCopied(false);dialogRef.current?.close();onClose?.()}
 async function copy(){
  if(!currentMessage){setStatus('Write a message before copying.');return}
  if(editing){setMessage(currentMessage);setEditing(false)}
  let success=false;
  try{await navigator.clipboard.writeText(shareText);success=true}catch{
   const field=document.createElement('textarea');field.value=shareText;field.style.cssText='position:fixed;opacity:0;pointer-events:none';dialogRef.current.append(field);field.focus();field.select();
   try{success=document.execCommand('copy')}catch{}field.remove();
  }
  setCopied(success);setManualCopy(!success);setStatus(success?`Your ${sharePoints?'points':'score'} and link are copied.`:'Automatic copying is unavailable. You can copy the text below.');
  if(!success)requestAnimationFrame(()=>{manual.current?.focus();manual.current?.select()});
 }
 return <dialog className="score-share-dialog" ref={dialogRef} aria-labelledby={titleId} onCancel={event=>{if(editing){event.preventDefault();finishEdit(false)}else{event.preventDefault();close()}}} onKeyDown={event=>{if(editing&&event.key==='Enter'&&(event.ctrlKey||event.metaKey)){event.preventDefault();finishEdit(true)}if(event.key==='Escape')event.stopPropagation()}}>
  <div className="score-share-header"><h2 id={titleId}>Share your {sharePoints?'points':'score'}</h2><button className="score-share-close" type="button" aria-label="Close share panel" onClick={close}><svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"><path d="m5 5 14 14M19 5 5 19"/></svg></button></div>
  <div className="score-share-total" aria-label={`${number.format(score)} SO/ COINS`}><span>{number.format(score)}</span><small>SO/ COINS</small></div>
  <div className="score-share-preview">
   {editing?<><label className="score-share-sr" htmlFor={editorId}>Your share message</label><textarea id={editorId} value={draft} maxLength={2000} rows={3} onChange={event=>setDraft(event.target.value)}/></>:<p>{message.split('SO/ FACET').map((part,index)=><React.Fragment key={index}>{index>0&&<span className="score-share-wordmark">SO/ FACET</span>}{part}</React.Fragment>)}</p>}
   <div className="score-share-meta"><span>shopsofacet.com/game</span><span>{editing&&<button type="button" onClick={()=>finishEdit(false)}>Cancel</button>}<button type="button" onClick={()=>editing?finishEdit(true):(setDraft(message),setEditing(true),setStatus(''))}>{editing?'Save message':'Edit message'}</button></span></div>
  </div>
  <div className="score-share-destinations" role="group" aria-label="Share destinations">{icons.map(service=><a key={service} href={destinations[service]} target="_blank" rel="noopener noreferrer" aria-label={`Share via ${service==='x'?'X':service==='gmail'?'Gmail':service[0].toUpperCase()+service.slice(1)}`} onClick={event=>{if(!currentMessage){event.preventDefault();setStatus('Write a message before sharing.')}else if(editing){setMessage(currentMessage);setEditing(false)}}}><span><img src={`/assets/share-icons/${service}.svg`} alt=""/></span>{service==='x'?'X':service[0].toUpperCase()+service.slice(1)}</a>)}</div>
  <button className="score-share-copy" type="button" onClick={()=>void copy()}><span>{copied?'Copied':`Copy ${sharePoints?'points':'score'} & link`}</span><svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><rect x="8" y="8" width="12" height="12" rx="1"/><path d="M15 8V4H4v11h4"/></svg></button>
  <p className="score-share-status" role="status" aria-live="polite">{status}</p>
  {manualCopy&&<div className="score-share-manual"><label htmlFor={manualId}>Select and copy your {sharePoints?'points':'score'} and link:</label><textarea id={manualId} ref={manual} readOnly rows={4} value={shareText}/></div>}
 </dialog>
}
