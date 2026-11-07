import {withSiteMetadata} from './site-metadata.mjs';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const css=readFileSync(new URL('../assets/game-loader.css',import.meta.url),'utf8');
const cards=readFileSync(new URL('../assets/loader-cards/markup.html',import.meta.url),'utf8');
const typographyVersion=createHash('sha256').update(readFileSync(new URL('../assets/typography.css',import.meta.url))).digest('hex').slice(0,12);
const cursorVersion=createHash('sha256').update(readFileSync(new URL('../assets/brand-cursor.css',import.meta.url))).digest('hex').slice(0,12);
const navigationCss=readFileSync(new URL('../assets/navigation.css',import.meta.url),'utf8');
const navigationVersion=createHash('sha256').update(navigationCss).digest('hex').slice(0,12);
const navigationScriptVersion=createHash('sha256').update(readFileSync(new URL('../navigation.js',import.meta.url))).digest('hex').slice(0,12);
const version=createHash('sha256').update(readFileSync(new URL('../assets/game-loader.js',import.meta.url))).digest('hex').slice(0,12);
const pageReady=readFileSync(new URL('../assets/page-ready.js',import.meta.url),'utf8');
const cookieScript=readFileSync(new URL('../assets/cookie-preferences.js',import.meta.url),'utf8');
const cookieCss=readFileSync(new URL('../assets/cookie-preferences.css',import.meta.url),'utf8');
const typographyStyles=['style.css','assets/legal-pages.css','assets/launching-soon.css','assets/first-cuts-confirmation.css'].map(path=>[path,createHash('sha256').update(readFileSync(new URL('../'+path,import.meta.url))).digest('hex').slice(0,12)]);
export function withGameLoader(html,{game=false,entry=''}={}){
 html=html.replace(/<link\b[^>]*data-brand-typography[^>]*>/g,'');
 html=html.replace(/<link\b[^>]*data-brand-cursor[^>]*>/g,'');
 html=withSiteMetadata(html).replace(/<!-- game-loader-head -->[\s\S]*?<!-- \/game-loader-head -->/g,'').replace(/<!-- game-loader-body -->[\s\S]*?<!-- \/game-loader-body -->/g,'');
 html=html.replace(/<!-- page-ready -->[\s\S]*?<!-- \/page-ready -->/g,'').replace(/<head\b[^>]*>(?:\s*<meta\b[^>]*charset[^>]*>)?/i,`$&<!-- page-ready --><style>html[data-loaded="false"]{background:#050505}html[data-loaded="false"] body{visibility:hidden!important;opacity:0!important}</style><script id="page-ready">${pageReady}</script><!-- /page-ready -->`);
 html=html.replace(/<!-- cookie-preferences -->[\s\S]*?<!-- \/cookie-preferences -->/g,'').replace('</head>',`<!-- cookie-preferences --><style>${cookieCss}</style><script id="cookie-preferences">${cookieScript}</script><!-- /cookie-preferences --></head>`);
 html=html.replace(/((?:href=["'])(?:\.\/|\.\.\/|\/)?assets\/navigation\.css)(?:\?[^"']*)?/g,'$1?v='+navigationVersion);
 html=html.replace(/((?:src=["'])(?:\.\/|\.\.\/|\/)?navigation\.js)(?:\?[^"']*)?/g,'$1?v='+navigationScriptVersion);
 for(const [path,hash] of typographyStyles){
  const pattern=new RegExp('((?:href=["\\\'])(?:\\./|\\.\\./|/)?'+path.replaceAll('.','\\.')+')(?:\\?[^"\\\']*)?','g');
  html=html.replace(pattern,'$1?v='+hash);
 }
 const failure="const fail=()=>{const root=document.getElementById('game-loading-screen');if(root){root.hidden=false;root.querySelector('.game-loading-error').hidden=false;root.querySelector('[data-game-retry]').onclick=()=>location.reload()}};document.readyState==='loading'?document.addEventListener('DOMContentLoaded',fail,{once:true}):fail()";
 const head=`<!-- game-loader-head --><style id="game-loader-critical">${game?navigationCss:''}${css}</style><link rel="preload" href="/assets/game-loader.js?v=${version}" as="script"><script id="game-loader-controller" src="/assets/game-loader.js?v=${version}" defer${game?` data-game-entry="${entry}"`:''} onerror="${failure}"></script><!-- /game-loader-head -->`;
 const markup=`<!-- game-loader-body --><div id="game-loading-screen" class="game-loading-screen"${game?'':' hidden'}><div id="game-loader-cards-root">${cards}</div><p class="loading-copy" role="status">Polishing your table… <span id="loading-detail"></span></p><div class="game-loading-error" role="alert" hidden><p>The game couldn’t load. Check your connection and try again.</p><button type="button" data-game-retry>Try again</button></div></div><!-- /game-loader-body -->`;
 return html.replace('</head>',head+`<link rel="stylesheet" href="/assets/typography.css?v=${typographyVersion}" data-brand-typography><link rel="stylesheet" href="/assets/brand-cursor.css?v=${cursorVersion}" data-brand-cursor></head>`).replace('</body>',markup+'</body>');
}
