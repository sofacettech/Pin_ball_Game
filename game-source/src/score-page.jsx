import React from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import {formatPoints,rewardMoney,resultHeadline} from './player-copy';
import './score-page.css';

function RollingLabel({children}){
 return <span className="score-page__roll"><span className="score-page__track"><span>{children}</span><span aria-hidden="true">{children}</span></span></span>;
}
function ScoreArcs(){
 return <svg className="score-page__arcs" viewBox="0 0 500 220" preserveAspectRatio="none" aria-hidden="true">
  <defs>
   <linearGradient id="score-arc-upper"><stop stopColor="#8a46d8" stopOpacity=".2"/><stop offset=".65" stopColor="#b668f2"/><stop offset=".88" stopColor="#fff"/><stop offset="1" stopColor="#b668f2"/></linearGradient>
   <linearGradient id="score-arc-lower"><stop stopColor="#f3e6ff"/><stop offset=".5" stopColor="#b668f2"/><stop offset="1" stopColor="#8a46d8" stopOpacity=".1"/></linearGradient>
   <filter id="score-arc-glow" x="-30%" y="-60%" width="160%" height="220%"><feGaussianBlur stdDeviation="2.2"/></filter>
  </defs>
  <g fill="none" strokeLinecap="round">
   <path className="score-page__arc-upper" d="M220 37 C310 7 410 6 461 29 C492 43 504 67 488 89" stroke="#a24fe8" strokeWidth="5" opacity=".55" filter="url(#score-arc-glow)"/>
   <path className="score-page__arc-upper" d="M220 37 C310 7 410 6 461 29 C492 43 504 67 488 89" stroke="url(#score-arc-upper)" strokeWidth="1.8"/>
   <path className="score-page__arc-lower" d="M8 145 C10 181 57 188 107 188 C170 190 235 181 306 173" stroke="#a24fe8" strokeWidth="5" opacity=".55" filter="url(#score-arc-glow)"/>
   <path className="score-page__arc-lower" d="M8 145 C10 181 57 188 107 188 C170 190 235 181 306 173" stroke="url(#score-arc-lower)" strokeWidth="1.8"/>
  </g>
 </svg>;
}
export function ScorePage({result,onSave,onReplay,onLeaderboard}){
 const low=result.points<10,formatted=formatPoints(result.points);
 return <div className="score-page">
  <img className="score-page__art" src="/assets/sofacet-score-ribbons.svg" alt="" aria-hidden="true"/>
  <div className="score-page__content">
   <div className="score-page__intro"><p className="score-page__eyebrow"><span>SO/ UNLOCKED</span><i aria-hidden="true"/></p><p className="score-page__sub">You’ve unlocked a facet.</p></div>
   <div className="score-page__body">
    <h1 id="rewards-heading" className="score-page__heading" tabIndex={-1}>{low?resultHeadline(result.points):<><strong>HERE’S</strong><em>what’s yours.</em></>}</h1>
    <div className="score-page__details">
     <p id="rewards-score" className="score-page__amount" style={{'--score-digits':Math.max(5,formatted.length)}}><ScoreArcs/><strong id="rewards-points">{formatted}</strong><span className="score-page__pts">pts</span></p>
     {low?<p id="rewards-low-copy" className="score-page__offer">Play again. Every 10 points is ₹1 off <span className="brand-word">SO/ FACET</span> diamond jewellery.</p>:<><p id="rewards-value-line" className="score-page__offer">That’s <strong id="rewards-value">{rewardMoney(result.points)} off</strong> <span className="brand-word">SO/ FACET</span> diamond jewellery.</p><p id="rewards-expiry" className="score-page__warning">Unsaved points disappear when you leave this page.</p></>}
    </div>
   </div>
   <div className="score-page__divider" aria-hidden="true"/>
   <div className={'score-page__actions'+(low?' is-single':'')}>
    {!low&&<button id="rewards-register" className="score-page__button" type="button" onClick={onSave}><RollingLabel>SAVE MY POINTS</RollingLabel><span className="score-page__arrow" aria-hidden="true">⟶</span></button>}
    <button id="rewards-retry" className="score-page__button" type="button" onClick={onReplay}><RollingLabel>PLAY AGAIN</RollingLabel><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.5 10.5A8 8 0 1 1 4.2 14.5M3.5 4V10.8H10.3"/></svg></button>
   </div>
   <button id="rewards-leaderboard" className="score-page__leaderboard" type="button" onClick={onLeaderboard}><RollingLabel>SEE FULL LEADERBOARD</RollingLabel></button>
  </div>
 </div>;
}
export function mountScorePage(container,actions){
 const root=createRoot(container);
 return {render(result){flushSync(()=>root.render(<ScorePage result={result} {...actions}/>))}};
}
