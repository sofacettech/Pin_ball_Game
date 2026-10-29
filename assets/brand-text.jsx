import React from 'react';
import './brand-text.css';
import {brandParts} from '../shared/brand-text.ts';

// Keep each name's existing text width and baseline while displaying the header artwork.
export function BrandText({children}) {
  if(typeof children!=='string')return children;
  return brandParts(children).map(({text:part,brand},index)=>brand?<span className="inline-brand" key={index}><span className="inline-brand__size" aria-hidden="true">{part}</span><img src="/assets/sofacet-wordmark.svg" alt={part} width="2048" height="278"/></span>:part);
}
