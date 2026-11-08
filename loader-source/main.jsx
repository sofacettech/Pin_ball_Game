import React from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import CardDeck from './CardDeck.jsx';
import {installGameLoader} from './controller.js';

let root;
installGameLoader((container,active,run,onComplete)=>{
  if(!root)root=createRoot(container);
  flushSync(()=>root.render(<CardDeck key={run} active={active} onComplete={onComplete}/>));
});
