import React from 'react';
import './brand-text.css';

// Keep each name's existing text width and baseline while displaying the header artwork.
export function BrandText({children}) {
  if(typeof children!=='string')return children;
  return children.split(/(\bSO\/FACET\b|\bSOFACET\b|\bSO FACET\b)/gi).map((part,index)=>index%2?<span className="inline-brand" key={index}><span className="inline-brand__size" aria-hidden="true">{part}</span><img src="/assets/sofacet-wordmark.svg" alt={part} width="2048" height="278"/></span>:part);
}
