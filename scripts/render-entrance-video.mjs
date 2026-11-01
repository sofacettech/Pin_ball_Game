import {build} from 'esbuild-wasm';
import {createServer} from 'node:http';
import {createRequire} from 'node:module';
import {mkdir, readFile, writeFile, stat, readdir, rename} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createHash} from 'node:crypto';
import {resolve, join, extname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {JOURNEY_START_FRAME} from '../entrance-source/journey-scroll.mjs';

// Offline frame capture: render time never determines animation time. The
// production renderer supplies the authored poses, materials and camera path.
const root=fileURLToPath(new URL('../',import.meta.url));
const work=resolve(root,'work/entrance-video');
const output=resolve(root,'assets/entrance-video');
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.SOFACET_PLAYWRIGHT_PATH||'playwright');
const ffmpeg=process.env.SOFACET_FFMPEG||'ffmpeg';
const preview=process.argv.includes('--preview');
const width=1920,height=1080,fps=60,lastFrame=2164;
await mkdir(work,{recursive:true});await mkdir(output,{recursive:true});
const bundled=await build({absWorkingDir:root,stdin:{contents:`
  import {createJourneyRenderer} from './entrance-source/journey-renderer.mjs';
  const stage=document.getElementById('stage');
  const view={fullWidth:${width},fullHeight:${height},width:${width},height:${height},x:0,y:0};
  const journey=await createJourneyRenderer({stage,pixelRatio:()=>1,renderView:()=>view});
  await journey.loadVariant('compact');
  let previousKind='opening';
  window.captureFrame=(kind,frame)=>{
    // Restore the cached final pose before leaving an arbitrary assembly pose.
    // AnimationMixer may skip unchanged channels at the stationary start time.
    if(kind==='journey'&&previousKind==='opening')journey.renderAssemblyAt(240);
    if(kind==='opening')journey.renderAssemblyAt(frame);else journey.renderAt(frame);
    previousKind=kind;
    return journey.renderer.domElement.toDataURL('image/png').split(',')[1];
  };
  window.captureReady=true;
`,resolveDir:root,sourcefile:'capture.mjs'},bundle:true,format:'esm',target:'es2022',write:false});
const server=createServer(async(req,res)=>{
  try{
    const path=new URL(req.url,'http://localhost').pathname;
    if(path==='/'){res.setHeader('Content-Type','text/html');return res.end(`<style>html,body{margin:0}#stage{width:${width}px;height:${height}px}canvas{display:block}</style><div id="stage"></div><script type="module" src="/capture.js"></script>`);}
    if(path==='/capture.js'){res.setHeader('Content-Type','text/javascript');return res.end(bundled.outputFiles[0].contents);}
    const file=resolve(root,'.'+decodeURIComponent(path));
    if(!file.startsWith(join(root,'assets')+'/')){res.writeHead(404);return res.end();}
    const info=await stat(file);res.setHeader('Content-Length',info.size);
    res.setHeader('Content-Type',({'.json':'application/json','.glb':'model/gltf-binary','.png':'image/png'})[extname(file)]||'application/octet-stream');
    createReadStream(file).pipe(res);
  }catch{res.writeHead(404);res.end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
let browser,activeEncoder;
const report={version:1,renderer:'production-threejs-reference',model:'assets/entrance-3d/journey-compact.glb',width,height,fps,
  firstFrame:JOURNEY_START_FRAME,lastFrame,encoding:{codec:'h264',crf:20,keyframeInterval:24,pixelFormat:'yuv420p',colorSpace:'bt709',fastStart:true},clips:{},sources:{}};
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
try{
  browser=await chromium.launch({args:process.platform==='darwin'?['--enable-gpu']:[]});
  const page=await browser.newPage({viewport:{width,height},deviceScaleFactor:1});
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
  await page.goto(`http://127.0.0.1:${server.address().port}`,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.captureReady,null,{timeout:180000});
  for(const [kind,frame] of [['opening',120],['journey',334],['journey',850],['journey',1100],['journey',1840],['journey',2164]]){
    const png=Buffer.from(await page.evaluate(([kind,frame])=>window.captureFrame(kind,frame),[kind,frame]),'base64');
    await writeFile(join(work,`${kind}-${frame}.png`),png);
  }
  if(errors.length)throw Error(errors.join('\n'));
  if(!preview){
    for(const [kind,start,end] of [['opening',1,240],['journey',JOURNEY_START_FRAME,lastFrame]]){
      const webTemporary=join(output,kind+'.download.mp4'),masterTemporary=join(work,kind+'-master.download.mp4');
      const args=['-hide_banner','-loglevel','error','-y','-f','image2pipe','-framerate',String(fps),'-vcodec','png','-i','pipe:0','-an',
        '-vf','scale=in_range=full:out_range=tv:out_color_matrix=bt709,format=yuv420p','-c:v','libx264','-preset','slow','-crf','20',
        '-g','24','-keyint_min','24','-sc_threshold','0','-bf','0','-bsf:v','h264_metadata=colour_primaries=1:transfer_characteristics=1:matrix_coefficients=1:video_full_range_flag=0','-color_primaries','bt709','-color_trc','bt709','-colorspace','bt709','-color_range','tv','-movflags','+faststart',webTemporary,
        '-an','-vf','scale=in_range=full:out_range=tv:out_color_matrix=bt709,format=yuv420p','-c:v','libx264','-preset','fast','-crf','10','-g','60','-movflags','+faststart',masterTemporary];
      const encoder=spawn(ffmpeg,args,{stdio:['pipe','ignore','inherit']});
      activeEncoder=encoder;
      const done=new Promise((resolve,reject)=>{encoder.once('error',reject);encoder.once('close',code=>code===0?resolve():reject(Error(`ffmpeg exited ${code}`)));});
      done.catch(()=>{});let pipeError;encoder.stdin.on('error',error=>{pipeError=error});
      const began=Date.now();
      for(let frame=start;frame<=end;frame++){
        if(pipeError)throw pipeError;
        if(errors.length)throw Error(errors.join('\n'));
        const png=Buffer.from(await page.evaluate(([kind,frame])=>window.captureFrame(kind,frame),[kind,frame]),'base64');
        if(!encoder.stdin.write(png))await once(encoder.stdin,'drain');
        if((frame-start)%60===0)console.log(`${kind}: ${frame-start+1}/${end-start+1} frames (${Math.round((Date.now()-began)/1000)}s)`);
      }
      encoder.stdin.end();await done;
      activeEncoder=null;
      await rename(webTemporary,join(output,kind+'.mp4'));await rename(masterTemporary,join(work,kind+'-master.mp4'));
      const bytes=await readFile(join(output,kind+'.mp4'));
      report.clips[kind]={file:kind+'.mp4',firstFrame:start,lastFrame:end,frameCount:end-start+1,bytes:bytes.length,sha256:hash(bytes)};
      console.log(`${kind}: ${(bytes.length/1e6).toFixed(2)} MB`);
    }
    const poster=spawn(ffmpeg,['-hide_banner','-loglevel','error','-y','-i',join(work,'journey-334.png'),'-frames:v','1','-q:v','2',join(output,'poster.jpg')],{stdio:'inherit'});
    const [code]=await once(poster,'close');if(code)throw Error('Poster encoding failed');
    for(const file of ['assets/entrance-3d/journey-compact.glb','assets/entrance-3d/camera-motion.json',...(await readdir(join(root,'entrance-source'))).filter(file=>/\.(mjs|js)$/.test(file)).sort().map(file=>'entrance-source/'+file)])report.sources[file]=hash(await readFile(join(root,file)));
    await writeFile(join(output,'manifest.json'),JSON.stringify(report,null,2)+'\n');
  }
  console.log(preview?`Review frames: ${work}`:`Export complete: ${output}`);
}finally{if(activeEncoder){activeEncoder.stdin.destroy();activeEncoder.kill('SIGTERM');}await browser?.close();await new Promise(resolve=>server.close(resolve));}
