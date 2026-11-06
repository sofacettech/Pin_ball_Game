import React from 'react';
import {brandParts} from '../shared/brand-text.ts';
import './brand-text.css';

// Use the logo typeface at the surrounding copy's existing font size.
export function BrandText({children}) {
 if(typeof children!=='string')return children;
 const parts=brandParts(children),nodes=parts.map((part,index)=>part.brand||part.coin?<span className={part.coin?'coin-word':'brand-word'} key={index}>{part.text}</span>:part.text);
 return parts.some(part=>part.coin)?<span className="coin-copy">{nodes}</span>:nodes;
}
