import {build} from 'vite';
import {mkdir,writeFile} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url));
const result=await build({root:resolve(root,'account-source'),publicDir:false,base:'./',build:{write:false,rollupOptions:{output:{entryFileNames:'assets/sofacet-account-[hash].js',chunkFileNames:'assets/sofacet-account-chunk-[hash].js',assetFileNames:'assets/sofacet-account-[hash][extname]'}}}});
for(const file of result.output){
 const name=file.fileName==='index.html'?'account.html':file.fileName;
 const destination=resolve(root,name);
 await mkdir(dirname(destination),{recursive:true});
 await writeFile(destination,file.type==='asset'?file.source:file.code);
}
