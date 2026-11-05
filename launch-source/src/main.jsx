import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import LaunchPage from '../../collective-source/LaunchPage.jsx';
import AuthFlow from '../../collective-source/AuthFlow.jsx';

function App(){
 const [email,setEmail]=useState(null);
 if(email!==null)return <AuthFlow initialTab="create" initialEmail={email} firstCut onBack={()=>setEmail(null)} onComplete={()=>location.assign('/first-cuts-confirmation.html')}/>;
 return <LaunchPage onJoin={({email})=>setEmail(email)} onPlay={()=>window.top.location.assign('/play.html')}/>;
}
createRoot(document.getElementById('launch-root')).render(<App/>);
