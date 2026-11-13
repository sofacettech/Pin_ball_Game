import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdir,readFile,writeFile,rename,copyFile,readdir,rm,stat} from 'node:fs/promises';
import {resolve,join,dirname,basename} from 'node:path';
import {parseArgs} from 'node:util';
import {indexEncoding} from './benchmark-entrance-encoding.mjs';
import {validateEntranceManifest} from '../entrance-source/video-delivery.mjs';

// Explicit opt-in offline candidate. It never changes the selected manifest,
// uploads to R2, overwrites a source or reduces the full-preload requirement.
const {values}=parseArgs({options:{master:{type:'string'},patch:{type:'string'},manifest:{type:'string'},gop:{type:'string',default:'4'},refs:{type:'string',default:'5'},output:{type:'string',default:'work/entrance-encoding-candidate'}}});
for(const key of ['master','patch','manifest'])if(!values[key])throw Error(`Supply --${key}`);
const master=resolve(values.master),patch=resolve(values.patch),basePath=resolve(values.manifest),output=resolve(values.output),gop=Number(values.gop),refs=Number(values.refs);
if(![4,12].includes(gop)||![2,5].includes(refs))throw Error('Use GOP4/12 and refs2/5 from the measured matrix');
for(const input of [master,patch,basePath])if(input.startsWith(output+'/'))throw Error('Use a separate candidate output directory');
await mkdir(output,{recursive:true});
if((await readdir(output)).length)throw Error('Use an empty candidate output directory; existing files are never overwritten');
function run(command,args){
  const result=spawnSync(command,args,{encoding:'utf8',maxBuffer:16*1024*1024});
  if(result.error)throw result.error;
  if(result.status!==0)throw Error(`${command} failed: ${result.stderr.slice(-3000)}`);
  return result;
}
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const probe=path=>JSON.parse(run('ffprobe',['-v','error','-show_packets','-show_streams','-of','json',path]).stdout);
const baseText=await readFile(basePath,'utf8'),base=validateEntranceManifest(JSON.parse(baseText),{width:3840,height:2160});
assert.equal(basename(basePath),`entrance-manifest-${hash(baseText)}.json`,'Verify the archived public manifest hash');
const originalStream=probe(master).streams.find(s=>s.codec_type==='video'),patchStream=probe(patch).streams.find(s=>s.codec_type==='video');
for(const [stream,count] of [[originalStream,1831],[patchStream,12]]){
  assert.equal(stream.width,3840);assert.equal(stream.height,2160);assert.equal(stream.r_frame_rate,'60/1');assert.equal(Number(stream.nb_frames),count);assert.equal(stream.pix_fmt,'yuv420p');
}
const filter="[1:v]setpts=PTS+588/(60*TB)[patch];[0:v][patch]overlay=eof_action=pass:repeatlast=0:format=yuv420:enable='between(n,588,599)'[patched]";
const inputs=['-i',master,'-i',patch,'-filter_complex',filter,'-map','[patched]'];
const md5=args=>run('ffmpeg',['-hide_banner','-loglevel','error',...args,'-an','-c:v','rawvideo','-pix_fmt','yuv420p','-f','framemd5','-']).stdout.trim().split('\n').filter(line=>!line.startsWith('#')).map(line=>line.split(',').at(-1).trim());
console.log('Verifying every unencoded source picture and the 922–933 replacement...');
const originalHashes=md5(['-i',master]),patchHashes=md5(['-i',patch]),filteredHashes=md5(inputs);
assert.equal(originalHashes.length,1831);assert.equal(patchHashes.length,12);assert.equal(filteredHashes.length,1831);
const expected=[...originalHashes];expected.splice(588,12,...patchHashes);
assert.deepEqual(filteredHashes,expected,'Patching must preserve every decoded YUV pixel outside the exact original-source patch');
console.log('All 1831 source pictures match the master, with only the 12 authoritative patch pictures replaced.');
const filePath=join(output,'journey-candidate.mp4'),began=performance.now();
run('ffmpeg',['-hide_banner','-loglevel','error','-y',...inputs,'-an','-c:v','libx264','-preset','slow','-crf','18','-g',String(gop),'-keyint_min',String(gop),'-sc_threshold','0','-bf','0','-refs',String(refs),
  '-r','60','-fps_mode','cfr','-pix_fmt','yuv420p','-bsf:v','h264_metadata=colour_primaries=1:transfer_characteristics=1:matrix_coefficients=1:video_full_range_flag=0',
  '-color_primaries','bt709','-color_trc','bt709','-colorspace','bt709','-color_range','tv','-movflags','+faststart',filePath]);
const encodeMs=performance.now()-began,bytes=await readFile(filePath),fullIndex=indexEncoding(bytes,probe(filePath),gop,1831),sha256=hash(bytes),file=`entrance-journey-${sha256}.mp4`;
await rename(filePath,join(output,file));
console.log(`Full GOP${gop}/refs${refs} journey: ${bytes.length} bytes (${Math.round(encodeMs/1000)} seconds encoding)`);
const quality=run('ffmpeg',['-hide_banner','-i',master,'-i',patch,'-i',join(output,file),'-filter_complex',filter.replace('[patched]','[truth]')+';[2:v][truth]ssim','-f','null','-']).stderr;
const ssimToPatchedMaster=Number(/All:([\d.]+)/.exec(quality)?.[1]);
if(!Number.isFinite(ssimToPatchedMaster))throw Error('Full candidate SSIM measurement failed');
const sections=join(output,'sections');await mkdir(sections,{recursive:true});
const segments=[];
try{
  run('ffmpeg',['-hide_banner','-loglevel','error','-y','-i',join(output,file),'-c','copy','-map','0:v:0','-f','segment','-segment_time','1','-reset_timestamps','1','-segment_format_options','movflags=+faststart',join(sections,'part-%03d.mp4')]);
  let firstFrame=334;
  for(const part of (await readdir(sections)).filter(file=>file.endsWith('.mp4')).sort()){
    const path=join(sections,part),sectionBytes=await readFile(path),parsed=probe(path),frameCount=parsed.packets.length,indexed=indexEncoding(sectionBytes,parsed,gop,frameCount),sha256=hash(sectionBytes),file=`entrance-journey-${sha256}.mp4`;
    assert.equal(indexed.decoder.description,fullIndex.decoder.description);assert.ok(frameCount<=60);assert.ok(sectionBytes.length<=24*1024*1024);
    segments.push({file,sha256,bytes:sectionBytes.length,firstFrame,lastFrame:firstFrame+frameCount-1,frameCount,frames:indexed.frames});
    firstFrame+=frameCount;await rename(path,join(output,file));
  }
  assert.equal(firstFrame,2165);assert.equal(segments.length,31);
}finally{await rm(sections,{recursive:true,force:true})}
// Copy the unchanged opening/proxy, so the candidate can be served from its own
// directory without requesting any media from the production configuration.
for(const clip of [base.clips.opening,base.clips.journey.preview].filter(Boolean)){
  const bytes=await readFile(join(dirname(basePath),clip.file));assert.equal(hash(bytes),clip.sha256);assert.equal(bytes.length,clip.bytes);
  await copyFile(join(dirname(basePath),clip.file),join(output,clip.file));
}
base.encoding={...base.encoding,crf:18,keyframeInterval:gop,referenceFrames:refs,source:'saved-high-quality-master-with-authoritative-12-frame-patch'};
base.clips.journey={...base.clips.journey,file,bytes:bytes.length,sha256,segments,decoder:fullIndex.decoder,encoding:{keyframeInterval:gop,referenceFrames:refs,bFrames:0,streamCopy:false}};
const preloadBytes=base.clips.opening.bytes+segments.reduce((sum,part)=>sum+part.bytes,0),budget=256*1024*1024;
// Full movie is the native fallback; WebCodecs preloads the section containers.
const nativePreloadBytes=base.clips.opening.bytes+bytes.length;
const json=JSON.stringify(base,null,2)+'\n',manifestFile=`entrance-manifest-${hash(json)}.json`;
await writeFile(join(output,manifestFile),json);
const report={version:1,createdAt:new Date().toISOString(),gop,refs,crf:18,encodeMs,manifestFile,baseManifest:basename(basePath),
  master:{sha256:hash(await readFile(master)),bytes:(await stat(master)).size,kind:'saved-lossy-high-quality-master'},patch:{firstFrame:922,lastFrame:933,sha256:hash(await readFile(patch))},
  sourcePixelVerification:{frames:1831,patchFrames:12,pixelExactBeforeEncoding:true,filteredFrameHashSha256:hash(filteredHashes.join('\n'))},
  journeyBytes:bytes.length,sectionBytes:segments.reduce((sum,part)=>sum+part.bytes,0),ssimToPatchedMaster,preloadBytes,nativePreloadBytes,budgetBytes:budget,
  withinPreloadBudget:preloadBytes<=budget&&nativePreloadBytes<=budget,
  note:'An opt-in candidate only. Full source-pixel replacement is proved before the lossy encode. Saved-master quality comparison and physical-phone performance validation remain necessary before production selection.'};
await writeFile(join(output,'candidate-report.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report));
if(!report.withinPreloadBudget)throw Error('Candidate exceeds the unchanged 256 MiB full preload budget; keep it out of production');
