import {build} from 'esbuild-wasm';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {readFile,writeFile} from 'node:fs/promises';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';

const root=new URL('../',import.meta.url),require=createRequire(import.meta.url);
await build({entryPoints:[fileURLToPath(new URL('../loader-source/main.jsx',import.meta.url))],bundle:true,format:'iife',target:'es2020',minify:true,legalComments:'none',define:{'process.env.NODE_ENV':'"production"'},outfile:fileURLToPath(new URL('../assets/game-loader.js',import.meta.url))});
const component=await build({entryPoints:[fileURLToPath(new URL('../loader-source/CardDeck.jsx',import.meta.url))],bundle:true,platform:'node',format:'cjs',packages:'external',write:false});
const module={exports:{}};new Function('module','exports','require',component.outputFiles[0].text)(module,module.exports,require);
await writeFile(new URL('assets/loader-cards/markup.html',root),renderToStaticMarkup(React.createElement(module.exports.default)));
await writeFile(new URL('assets/game-loader.css',root),await readFile(new URL('loader-source/style.css',root),'utf8'));

// Refresh the same loader shell in development entry documents.
const {withGameLoader}=await import('./game-loader-shell.mjs');
for(const name of ['game','membership','account','launch','faq','about']){
 const file=new URL(name+'-source/index.html',root);
 await writeFile(file,withGameLoader(await readFile(file,'utf8')));
}
