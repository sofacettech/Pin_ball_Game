import React from 'react';
import {createRoot} from 'react-dom/client';
import LaunchPage from '../../collective-source/LaunchPage.jsx';
import '../../collective-source/flow.css';
import {request} from '../../membership-source/src/api.js';
import {accountNavigationHref} from '../../shared/account-session.js';
async function join(values){
  const result=await request('/api/first-cuts',values);
  if(result.success!==true)throw Error('Your signup has not been saved. Please try again.');
  const href=accountNavigationHref('/first-cuts-confirmation.html');
  if(window.sofacetGameInfo)window.sofacetGameInfo.visit(href);else window.top.location.assign(href);
}
createRoot(document.getElementById('launch-root')).render(<LaunchPage onJoin={join} onPlay={()=>window.top.location.assign('/play.html')}/>);
