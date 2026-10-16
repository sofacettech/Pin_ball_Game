import {build} from 'vite';
import {mkdir,writeFile} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url));
const result=await build({root:resolve(root,'game-source'),publicDir:false,base:'./',build:{write:false}});
for(const file of result.output){
 const name=file.fileName==='index.html'?'play.html':file.fileName;
 let content=file.type==='asset'?file.source:file.code;
 if(name==='play.html'){
  content=String(content).replace('<head>','<head><style>html,body{background:#000;margin:0}</style>');
  content=content.replace('class="brand" href="/"','class="brand" href="/" target="_top"');
 }
 const destination=resolve(root,name);
 await mkdir(dirname(destination),{recursive:true});
 await writeFile(destination,content);
}
