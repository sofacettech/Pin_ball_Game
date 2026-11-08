import React,{useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import LaunchPage from '../../collective-source/LaunchPage.jsx';
import '../../collective-source/flow.css';
import {request} from '../../membership-source/src/api.js';
import {accountNavigationHref} from '../../shared/account-session.js';
async function join(values){
  const result=await request('/api/first-cuts',values);
  if(result.success!==true)throw Error('Your signup has not been saved. Please try again.');
  const href=accountNavigationHref('/confirmation');
  if(window.sofacetGameInfo)window.sofacetGameInfo.visit(href);else window.top.location.assign(href);
}
function App(){
 const [member,setMember]=useState(null);
 useEffect(()=>{
  const controller=new AbortController();
  const refresh=()=>request('/api/player',undefined,controller.signal).then(player=>{if(!controller.signal.aborted)setMember(player.member===true)},()=>{if(!controller.signal.aborted)setMember(false)});
  const restored=event=>{if(event.persisted)void refresh()};
  void refresh();window.addEventListener('pageshow',restored);
  return()=>{controller.abort();window.removeEventListener('pageshow',restored)};
 },[]);
 return <LaunchPage onJoin={join} onPlay={()=>window.top.location.assign('/game')} isMember={member===true} checkingMember={member===null}/>;
}
createRoot(document.getElementById('launch-root')).render(<App/>);
