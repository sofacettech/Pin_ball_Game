import {build} from 'vite';
import {withGameLoader} from './game-loader-shell.mjs';
import {mkdir,writeFile} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url));
const result=await build({root:resolve(root,'game-source'),publicDir:false,base:'./',build:{write:false,rollupOptions:{output:{entryFileNames:'assets/sofacet-game-[hash].js',chunkFileNames:'assets/sofacet-game-chunk-[hash].js',assetFileNames:'assets/sofacet-game-[hash][extname]'}}}});
for(const file of result.output){
 const name=file.fileName==='index.html'?'play.html':file.fileName;
 let content=file.type==='asset'?file.source:file.code;
 if(name==='play.html'){
  content=String(content).replace('<head>','<head><style>html,body{background:#000;margin:0}</style>');
  let entry='';
  content=content.replace(/<script type="module" crossorigin src="([^"]*sofacet-game-[^"]+\.js)"><\/script>/,(_match,url)=>{entry=url;return ''});
  if(!entry)throw Error('Game entry module was not found');
  content=content.replace(/<link rel="stylesheet" crossorigin href="([^"]+)">/, `<link id="game-entry-style" rel="stylesheet" crossorigin href="$1" media="print" onload="this.media='all'" onerror="this.dataset.failed='true'">`);
  content=withGameLoader(content,{game:true,entry});
 }
 const destination=resolve(root,name);
 await mkdir(dirname(destination),{recursive:true});
 await writeFile(destination,content);
}
