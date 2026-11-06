import React from 'react';
import {brandParts} from '../shared/brand-text.ts';

// Keep inline brand names in the same wordmark font used throughout the site.
export function BrandText({children}) {
  if(typeof children!=='string')return children;
  return brandParts(children).map(({text:part,brand},index)=>brand?<span className="brand-word" key={index}>{part}</span>:part);
}
