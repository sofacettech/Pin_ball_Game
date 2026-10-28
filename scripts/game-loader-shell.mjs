import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const css=readFileSync(new URL('../assets/game-loader.css',import.meta.url),'utf8');
const navigationCss=readFileSync(new URL('../assets/navigation.css',import.meta.url),'utf8');
const navigationVersion=createHash('sha256').update(navigationCss).digest('hex').slice(0,12);
const version=createHash('sha256').update(readFileSync(new URL('../assets/game-loader.js',import.meta.url))).digest('hex').slice(0,12);
export function withGameLoader(html,{game=false,entry=''}={}){
 html=String(html).replace(/<!-- game-loader-head -->[\s\S]*?<!-- \/game-loader-head -->/g,'').replace(/<!-- game-loader-body -->[\s\S]*?<!-- \/game-loader-body -->/g,'');
 html=html.replace(/((?:href=["'])(?:\.\/|\.\.\/|\/)?assets\/navigation\.css)(?:\?[^"']*)?/g,'$1?v='+navigationVersion);
 const failure="const fail=()=>{const root=document.getElementById('game-loading-screen');if(root){root.hidden=false;root.querySelector('.game-loading-error').hidden=false;root.querySelector('[data-game-retry]').onclick=()=>location.reload()}};document.readyState==='loading'?document.addEventListener('DOMContentLoaded',fail,{once:true}):fail()";
 const head=`<!-- game-loader-head --><style id="game-loader-critical">${game?navigationCss:''}${css}</style><link rel="preload" href="/assets/game-loader.js?v=${version}" as="script"><script id="game-loader-controller" src="/assets/game-loader.js?v=${version}" defer${game?` data-game-entry="${entry}"`:''} onerror="${failure}"></script><!-- /game-loader-head -->`;
 const markup=`<!-- game-loader-body --><div id="game-loading-screen" class="game-loading-screen"${game?'':' hidden'}><canvas aria-hidden="true"></canvas><p class="loading-statement" aria-live="polite" aria-atomic="true" hidden><span class="loading-phrase"></span></p><p class="loading-copy" role="status">Preparing your table. <span id="loading-detail"></span></p><div class="game-loading-error" role="alert" hidden><p>The game couldn’t load. Check your connection and try again.</p><button type="button" data-game-retry>Try again</button></div></div><!-- /game-loader-body -->`;
 return html.replace('</head>',head+'</head>').replace('</body>',markup+'</body>');
}
