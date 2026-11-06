import React from 'react';
import {createRoot} from 'react-dom/client';
import AuthFlow from '../../collective-source/AuthFlow.jsx';
import './style.css';

const params=new URLSearchParams(location.search);
const pageTitle=params.get('from')==='collective'?'SO/ FACET — Join SO/ COLLECTIVE':'SO/ FACET — My SO/ COINS';
document.title=pageTitle;
createRoot(document.getElementById('membership-root')).render(<AuthFlow pageTitle={pageTitle} initialTab={params.get('verify')==='1'?'registered':'create'} forceVerification={params.get('verify')==='1'} claimFirst={params.get('from')==='score'} firstCut={['first-cuts','collective'].includes(params.get('from'))}/>);
