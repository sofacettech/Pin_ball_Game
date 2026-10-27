import {build} from 'esbuild-wasm';
import {withGameLoader} from './game-loader-shell.mjs';
import {withEntrancePresentation} from './entrance-presentation.mjs';
import {brotliCompressSync,constants} from 'node:zlib';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {basename,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url));
// Refresh the shared loader's CSS and content hash on non-Vite pages too.
for(const page of ['index.html','privacy.html','launching-soon.html','first-cuts-confirmation.html']){
  const file=resolve(root,page);
  await writeFile(file,withGameLoader(await readFile(file,'utf8')));
}
const output=resolve(root,'assets/entrance-3d');
await mkdir(output,{recursive:true});
// Only this route imports the Three.js bundle. Shared presentation modules stay
// external so both entrances use the same fonts, copy, video opening and audio.
const result=await build({absWorkingDir:root,entryPoints:{entry:'entrance-source/entrance.mjs',startup:'entrance-source/startup.mjs'},outdir:output,
  bundle:true,splitting:true,format:'esm',target:'es2022',minify:true,write:false,metafile:true,
  external:['/assets/*','/frame-placement.js','/sounds/*'],
  entryNames:'entry-[hash]',chunkNames:'chunk-[hash]',assetNames:'asset-[hash]',
});
for(const file of result.outputFiles)await writeFile(file.path,file.contents);
const entry=Object.entries(result.metafile.outputs).find(([,file])=>file.entryPoint==='entrance-source/entrance.mjs')?.[0];
if(!entry)throw Error('Entrance build did not produce an entry module.');
const css=await readFile(resolve(root,'entrance-source/entrance.css'),'utf8');
const startup=Object.entries(result.metafile.outputs).find(([,file])=>file.entryPoint==='entrance-source/startup.mjs')?.[0];
if(!startup)throw Error('Entrance build did not produce its startup module.');
const source=await readFile(resolve(root,'index.html'),'utf8');
let sharedStyles='';
for(const [,href] of source.matchAll(/<link rel="stylesheet" href="([^"]+)"[^>]*>/g)){
  const path=href.split('?')[0].replace(/^\.?\//,'');
  let style=await readFile(resolve(root,path),'utf8');
  // Inline the small shared styles so the first visible UI needs no CSS round trip.
  for(const [rule,importPath] of style.matchAll(/@import (?:url\()?['"]([^'"]+)['"]\)?;?/g)){
    style=style.replace(rule,await readFile(resolve(root,importPath.split('?')[0]),'utf8'));
  }
  sharedStyles+=`<style data-shared-style="${href}">${style}</style>\n`;
}
const html=withGameLoader(withEntrancePresentation(await readFile(resolve(root,'entrance-source/entrance.html'),'utf8'),source));
await writeFile(resolve(root,'entrance-3d.html'),html
  .replace('__ENTRANCE_JS__',`/assets/entrance-3d/${basename(entry)}`)
  .replace('__STARTUP_JS__',`/assets/entrance-3d/${basename(startup)}`)
  .replace('__SHARED_STYLES__',sharedStyles)
  .replace('__ENTRANCE_CSS__',css)
  .replace('id="game-loading-screen"','id="game-loading-screen" data-managed')
  .replace(/[\t ]+$/gm,''));
// Meshopt handles geometry; HTTP Brotli additionally compresses its buffers and
// scene metadata. Generate at build time, never on the request's critical path.
for(const name of ['journey-compact.glb']){
  const file=resolve(output,name);
  await writeFile(file+'.br',brotliCompressSync(await readFile(file),{params:{[constants.BROTLI_PARAM_QUALITY]:6}}));
}
