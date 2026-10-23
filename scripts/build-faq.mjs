import {build} from 'vite';
import {withGameLoader} from './game-loader-shell.mjs';
import {mkdir,writeFile} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url));
const result=await build({root:resolve(root,'faq-source'),publicDir:false,base:'./',build:{write:false,rollupOptions:{output:{entryFileNames:'assets/sofacet-faq-[hash].js',chunkFileNames:'assets/sofacet-faq-chunk-[hash].js',assetFileNames:'assets/sofacet-faq-[hash][extname]'}}}});
for(const file of result.output){
 const name=file.fileName==='index.html'?'faq.html':file.fileName;
 const destination=resolve(root,name);
 await mkdir(dirname(destination),{recursive:true});
 await writeFile(destination,name.endsWith('.html')?withGameLoader(file.source):file.type==='asset'?file.source:file.code);
}
