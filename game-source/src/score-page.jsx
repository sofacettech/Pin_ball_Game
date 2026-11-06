import React from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import {formatPoints,rewardMoney,resultHeadline} from './player-copy';
import PageShell from '../../collective-source/PageShell.jsx';
import {RewardArtwork,RewardMesh} from '../../collective-source/artwork/RewardArtwork.jsx';
import initialize from '../../collective-source/scenes/rewards.js';
import {Arrow,Replay} from '../../collective-source/icons.jsx';
import './reward-integration.css';

export function ScorePage({result,onSave,onReplay,onLeaderboard}) {
 const low=result.points<10;
 return <PageShell scene="rewards" initialize={initialize} title="SO/ FACET — Pinball">
  <RewardMesh/><RewardArtwork/>
  <main className="page text-layer"><section className="reward" aria-label="Your unlocked reward">
   <div className="brand">SO/ UNLOCKED</div>
   <div className="headline-pair">
    <div className="headline-left"><p className="eyebrow">You've unlocked a facet.</p><h1 id="rewards-heading" tabIndex={-1}>{low?resultHeadline(result.points):<><span>HERE’S</span><span>what’s yours.</span></>}</h1></div>
    <div className="headline-right"><div className="amount-line" id="rewards-score"><strong className="amount" id="rewards-points" style={formatPoints(result.points).length>6?{fontSize:'clamp(48px,7vw,108px)'}:undefined}>{formatPoints(result.points)}</strong><span className="coins">SO/ COINS</span></div>
    {low?<p className="conversion" id="rewards-low-copy">Play again. Every 10 SO/ COINS is ₹1 off <span className="wordmark">SO/ FACET</span> diamond jewellery.</p>:<p className="conversion" id="rewards-value-line">That's <strong id="rewards-value">{rewardMoney(result.points)} off</strong> <span className="wordmark">SO/ FACET</span> diamond jewellery.</p>}
    </div>
   </div>
   <hr className="rule"/>
   {!low&&<p className="notice" id="rewards-expiry">Unsaved SO/ COINS disappear when you leave this page.</p>}
   <div className="buttons">
    {!low&&<button className="btn" id="rewards-register" type="button" onClick={onSave}><span>SAVE MY SO/ COINS</span><Arrow/></button>}
    <button className="btn" id="rewards-retry" type="button" onClick={onReplay}>PLAY AGAIN <Replay/></button>
   </div>
   <button className="leaderboard" id="rewards-leaderboard" type="button" onClick={onLeaderboard}>See full leaderboard →</button>
  </section></main>
 </PageShell>;
}
export function mountScorePage(container,actions){
 const root=createRoot(container);
 return {render(result){flushSync(()=>root.render(<ScorePage result={result} {...actions}/>));},clear(){root.render(null);}};
}
