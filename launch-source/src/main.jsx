import React from 'react';
import {createRoot} from 'react-dom/client';
import LaunchPage from '../../collective-source/LaunchPage.jsx';
import '../../collective-source/flow.css';
import {request} from '../../membership-source/src/api.js';
async function join(values){const result=await request('/api/first-cuts',values);if(result.success!==true)throw Error('Your signup has not been saved. Please try again.');window.top.location.assign('/first-cuts-confirmation.html');}
createRoot(document.getElementById('launch-root')).render(<LaunchPage onJoin={join} onPlay={()=>window.top.location.assign('/play.html')}/>);
