import React from 'react';
import {brandParts} from '../shared/brand-text.ts';
import './brand-text.css';

// Use the logo typeface at the surrounding copy's existing font size.
export function BrandText({children}) {
 if(typeof children!=='string')return children;
 return brandParts(children).map((part,index)=>part.brand?<span className="brand-word" key={index}>{part.text}</span>:part.text);
}
