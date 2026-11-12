import React from 'react';
import {createRoot} from 'react-dom/client';
import AuthFlow, {joinPageTitle} from '../../collective-source/AuthFlow.jsx';
import './style.css';

const params=new URLSearchParams(location.search);
const joining=location.pathname==='/join';
const pageTitle=joining?joinPageTitle:'SO/ FACET — My SO/ COINS';
document.title=pageTitle;
const cameFromSite=window.parent===window&&history.length>1&&document.referrer&&new URL(document.referrer).origin===location.origin;
const onBack=cameFromSite||window.name==='sofacet-game-info'?()=>window.top.history.back():undefined;
createRoot(document.getElementById('membership-root')).render(<AuthFlow pageTitle={pageTitle} initialTab={params.get('verify')==='1'?'registered':'create'} forceVerification={params.get('verify')==='1'} firstCut={joining&&params.get('from')!=='account'} onBack={onBack}/>);
