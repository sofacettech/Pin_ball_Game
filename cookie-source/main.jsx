import React from 'react';
import {createRoot} from 'react-dom/client';
import CookiePopup from './CookiePopup.jsx';

if(window.top===window){
 const container=document.createElement('div');container.id='sf-cookie-root';document.body.append(container);
 const root=createRoot(container);
 window.sofacetCookiePreferences.mount(props=>root.render(<CookiePopup {...props}/>));
}
