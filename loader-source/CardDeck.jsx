import React, {useLayoutEffect, useRef} from 'react';
import {connectCardMotion} from './card-motion.js';

const artwork='/assets/loader-cards/';
const cards=[
  {name:'Diamond',product:'diamond',width:535,height:425,alt:'Faceted diamond',copy:<div className="card-copy diamond-copy"><p>Up Next:</p><h1>Pinball</h1></div>},
  {name:'Pinball',product:'pinball',width:740,height:595,alt:'SO/ FACET pinball table',copy:<div className="card-copy table-copy"><p className="table-title">Score <span className="coin-word">SO/ COINS</span>.</p><p className="table-detail">Save them for<br/><span className="brand-word">SO/ FACET</span> diamond jewellery.</p></div>},
  {name:'Jewellery',product:'earrings',width:515,height:415,alt:'Pair of SO/ FACET black and white diamond star earrings',copy:<div className="card-copy jewellery-copy"><p className="offer">1,000 <span className="coin-word">SO/ COINS</span> = <span className="rupee">₹</span>100 OFF</p><p className="offer-detail"><span className="brand-word">SO/ FACET</span> DIAMOND JEWELLERY</p></div>},
];
export default function CardDeck({active=false,onComplete}) {
  const root=useRef(null),motion=useRef(null);
  useLayoutEffect(()=>{motion.current=connectCardMotion(root.current,onComplete);return()=>motion.current.dispose();},[onComplete]);
  useLayoutEffect(()=>{motion.current.setActive(active);},[active]);
  return <div className="game-loader-cards" ref={root}>
    <div className="gallery" aria-label="SO/ FACET silver card collection">
      <p className="card-hint card-hint-top"><span className="hint-click">Click to Explore</span><span className="hint-swipe">Swipe left to explore</span></p>
      <div className="stage" aria-busy="false"><div className="floating">
      <div className="deck" tabIndex={0} role="button" aria-label="Diamond card. Front view" aria-describedby="loader-card-instructions">
        {cards.map((card,index)=><article className="sofacet-card" key={card.product} data-slot={index} aria-label={card.name+' card'} aria-hidden={index!==0}>
          <div className="card-turn"><div className="face front-face" aria-hidden="false">
            <img className="sofacet-card__background" src={artwork+'card.svg?v=faceted-platinum-20261107'} alt="" width={806} height={1330} loading="lazy" decoding="async"/>
            <img className={'sofacet-card__product product--'+card.product} src={artwork+card.product+'.png'} alt={card.alt} width={card.width} height={card.height} loading="lazy" decoding="async"/>
            {card.copy}
          </div><div className="face reverse-face" aria-hidden="true">
            <img className="sofacet-card__background" src={artwork+'card-back.svg?v=faceted-platinum-20261107'} alt="" width={806} height={1330} loading="eager" decoding="async"/>
            <p className="back-name"><img src="/assets/sofacet-wordmark.svg" alt="SO/ FACET" width={2048} height={278}/></p>
          </div></div>
        </article>)}
      </div>
    </div></div>
    </div>
    <p className="sr-only" id="loader-card-instructions">On mobile, swipe to advance. On desktop, click or press an arrow key to advance. On a keyboard, use Enter to flip and Space to pause or resume. Each card advances automatically after 8 seconds.</p>
    <p className="sr-only" data-card-status aria-live="polite" aria-atomic="true">Diamond card, 1 of 3.</p>
  </div>;
}
