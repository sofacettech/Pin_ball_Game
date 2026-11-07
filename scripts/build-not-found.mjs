import {build} from 'vite';
import {withGameLoader} from './game-loader-shell.mjs';
import {mkdir,writeFile} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url));
// The 404 document can be served at any depth, so its assets use root URLs.
const result=await build({root:resolve(root,'not-found-source'),publicDir:false,base:'/',build:{write:false,rollupOptions:{output:{entryFileNames:'assets/sofacet-not-found-[hash].js',chunkFileNames:'assets/sofacet-not-found-chunk-[hash].js',assetFileNames:'assets/sofacet-not-found-[name]-[hash][extname]'}}}});
for(const file of result.output){
  const name=file.fileName==='index.html'?'404.html':file.fileName;
  const destination=resolve(root,name);
  await mkdir(dirname(destination),{recursive:true});
  await writeFile(destination,name.endsWith('.html')?withGameLoader(file.source):file.type==='asset'?file.source:file.code);
}
