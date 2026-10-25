import {build} from 'esbuild-wasm';
import {createHash} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {basename,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url));
const output=resolve(root,'assets/entrance-3d');
await mkdir(output,{recursive:true});
// Only this route imports the Three.js bundle. Shared presentation modules stay
// external so both entrances use the same fonts, copy, video opening and audio.
const result=await build({absWorkingDir:root,entryPoints:{entry:'entrance-source/entrance.mjs'},outdir:output,
  bundle:true,splitting:true,format:'esm',target:'es2022',minify:true,write:false,metafile:true,
  external:['/assets/*','/frame-placement.js','/sounds/*'],
  entryNames:'entry-[hash]',chunkNames:'chunk-[hash]',assetNames:'asset-[hash]',
});
for(const file of result.outputFiles)await writeFile(file.path,file.contents);
const entry=Object.entries(result.metafile.outputs).find(([,file])=>file.entryPoint==='entrance-source/entrance.mjs')?.[0];
if(!entry)throw Error('Entrance build did not produce an entry module.');
const css=await readFile(resolve(root,'entrance-source/entrance.css'),'utf8');
const cssFile=`entrance-${createHash('sha256').update(css).digest('hex').slice(0,12)}.css`;
await writeFile(resolve(output,cssFile),css);
const html=await readFile(resolve(root,'entrance-source/entrance.html'),'utf8');
await writeFile(resolve(root,'entrance-3d.html'),html
  .replace('__ENTRANCE_JS__',`/assets/entrance-3d/${basename(entry)}`)
  .replace('__ENTRANCE_CSS__',`/assets/entrance-3d/${cssFile}`));
