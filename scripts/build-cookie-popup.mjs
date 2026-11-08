import {build} from 'esbuild-wasm';
import {copyFile,mkdir,readFile,readdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';

const root=new URL('../',import.meta.url);
await build({entryPoints:[fileURLToPath(new URL('cookie-source/main.jsx',root))],bundle:true,format:'iife',target:'es2020',minify:true,legalComments:'none',define:{'process.env.NODE_ENV':'"production"'},outfile:fileURLToPath(new URL('assets/cookie-popup.js',root))});
await mkdir(new URL('assets/cookie-popup-fonts/',root),{recursive:true});
for(const file of await readdir(new URL('cookie-source/fonts/',root)))await copyFile(new URL('cookie-source/fonts/'+file,root),new URL('assets/cookie-popup-fonts/'+file,root));
await writeFile(new URL('assets/cookie-preferences.css',root),await readFile(new URL('cookie-source/style.css',root)));
