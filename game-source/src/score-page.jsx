import React,{useEffect,useState} from 'react';
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
 return <PageShell scene="rewards" initialize={initialize} title="SO/ UNLOCKED — Your reward">
  <RewardMesh/><RewardArtwork/>
  <main className="page text-layer"><section className="reward" aria-label="Your unlocked reward">
   <div className="brand">SO/ UNLOCKED</div>
   <div className="headline-pair">
    <div className="headline-left"><p className="eyebrow">You've unlocked a facet.</p><h1 id="rewards-heading" tabIndex={-1}>{low?resultHeadline(result.points):<><span>HERE’S</span><span>what’s yours.</span></>}</h1></div>
    <div className="headline-right"><div className="amount-line" id="rewards-score"><strong className="amount" id="rewards-points" style={formatPoints(result.points).length>6?{fontSize:'clamp(48px,7vw,108px)'}:undefined}>{formatPoints(result.points)}</strong><span className="coins">SO/ COINS</span></div>
    {low?<p className="conversion" id="rewards-low-copy">Play again. Every 10 points is ₹1 off <span className="wordmark">SO/FACET</span> diamond jewellery.</p>:<p className="conversion" id="rewards-value-line">That's <strong id="rewards-value">{rewardMoney(result.points)} off</strong> <span className="wordmark">SO/FACET</span> diamond jewellery.</p>}
    </div>
   </div>
   <hr className="rule"/>
   {!low&&<p className="notice" id="rewards-expiry">Unsaved coins disappear when you leave this page.</p>}
   <div className="buttons">
    {!low&&<button className="btn" id="rewards-register" type="button" onClick={onSave}>SAVE MY COINS <Arrow/></button>}
    <button className="btn" id="rewards-retry" type="button" onClick={onReplay}>PLAY AGAIN <Replay/></button>
   </div>
   <LeaderboardPreview result={result}/>
   <button className="leaderboard" id="rewards-leaderboard" type="button" onClick={onLeaderboard}>See full leaderboard →</button>
  </section></main>
 </PageShell>;
}
function LeaderboardPreview({result}){
 const [board,setBoard]=useState(null),[failed,setFailed]=useState(false);
 useEffect(()=>{let active=true,revision=0;const abort=new AbortController();async function load(){const current=++revision;try{const response=await fetch('/api/leaderboard',{signal:abort.signal});if(!response.ok)throw Error();const data=await response.json();if(!Array.isArray(data.entries))throw Error();if(active&&current===revision){setBoard(data);setFailed(false)}}catch(error){if(active&&error.name!=='AbortError')setFailed(true)}}void load();window.addEventListener('sofacet:leaderboard-updated',load);return()=>{active=false;abort.abort();window.removeEventListener('sofacet:leaderboard-updated',load)}},[result.gameId,result.points]);
 const me=board?.me,points=me?.points??result.points;
 return <section className="leaderboard-preview" aria-labelledby="preview-title"><h2 id="preview-title">Leaderboard</h2><p className="preview-you">You · {me?.rank?'#'+me.rank:'—'} · {formatPoints(points)} pts</p>
 {board?<ol>{board.entries.slice(0,3).map(row=><li key={row.rank}><span>{row.rank}</span><span>{row.display_name}</span><span>{formatPoints(row.points)}</span></li>)}</ol>:<p role="status">{failed?'Leaderboard unavailable.':'Loading the leaderboard…'}</p>}
 {board?.saved!==true&&<p className="preview-save">Save your points to put your name on it.</p>}</section>;
}
export function mountScorePage(container,actions){
 const root=createRoot(container);
 return {render(result){flushSync(()=>root.render(<ScorePage result={result} {...actions}/>));},clear(){root.render(null);}};
}
