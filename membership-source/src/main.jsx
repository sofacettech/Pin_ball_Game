import React from 'react';
import {createRoot} from 'react-dom/client';
import AuthFlow from '../../collective-source/AuthFlow.jsx';
import './style.css';

const params=new URLSearchParams(location.search);
createRoot(document.getElementById('membership-root')).render(<AuthFlow initialTab={params.get('verify')==='1'?'registered':'create'} forceVerification={params.get('verify')==='1'} claimFirst={params.get('from')==='score'} firstCut={params.get('from')==='first-cuts'}/>);
