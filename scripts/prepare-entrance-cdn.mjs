import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdir,mkdtemp,readFile,readdir,writeFile,rename,rm} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';

// Keep the high-quality renders outside Git and the application deployment.
// The opening plays normally. The scroll movie needs short prediction chains
// and no B frames so reverse seeking does not stall Safari's decoder.
const root=fileURLToPath(new URL('../',import.meta.url));
const ultra=process.argv.includes('--4k');
const work=join(root,ultra?'work/entrance-video-4k':'work/entrance-video');
const output=join(work,'cdn');
const crf=ultra?18:20,keyframeInterval=12;
await mkdir(output,{recursive:true});
const manifest=JSON.parse(await readFile(ultra?join(work,'rendered/manifest.json'):join(root,'assets/entrance-video/manifest.json'),'utf8'));
manifest.encoding={codec:'h264',crf,pixelFormat:'yuv420p',colorSpace:'bt709',fastStart:true,source:ultra?'native-4k-render':'saved-master'};
for(const kind of ['opening','journey']){
  const seekable=kind==='journey';
  const temporary=join(output,kind+'.mp4');
  const result=spawnSync('ffmpeg',['-hide_banner','-loglevel','error','-y','-i',ultra?join(work,`rendered/${kind}.mp4`):join(work,`${kind}-master.mp4`),
    '-an',...(seekable&&!ultra?['-c:v','libx264','-preset','slow','-crf',String(crf),'-g',String(keyframeInterval),'-keyint_min',String(keyframeInterval),'-sc_threshold','0','-bf','0','-pix_fmt','yuv420p']:['-c:v','copy']),
    '-bsf:v','h264_metadata=colour_primaries=1:transfer_characteristics=1:matrix_coefficients=1:video_full_range_flag=0',
    '-color_primaries','bt709','-color_trc','bt709','-colorspace','bt709','-color_range','tv','-movflags','+faststart',temporary],{stdio:'inherit'});
  if(result.error)throw result.error;
  if(result.status!==0)throw Error(`ffmpeg failed for ${kind}`);
  const probe=spawnSync('ffprobe',['-v','error','-count_frames','-show_entries','stream=codec_name,width,height,r_frame_rate,nb_read_frames,has_b_frames,color_primaries,color_transfer,color_space','-of','json',temporary],{encoding:'utf8'});
  if(probe.status!==0)throw Error(`ffprobe failed for ${kind}`);
  const [stream]=JSON.parse(probe.stdout).streams;
  if(stream.codec_name!=='h264'||stream.width!==manifest.width||stream.height!==manifest.height||stream.r_frame_rate!=='60/1'||Number(stream.nb_read_frames)!==manifest.clips[kind].frameCount||
    ['color_primaries','color_transfer','color_space'].some(key=>stream[key]!=='bt709')||seekable&&stream.has_b_frames!==0)throw Error(`Invalid ${kind} master`);
  const bytes=await readFile(temporary),sha256=createHash('sha256').update(bytes).digest('hex');
  const file=`entrance-${kind}-${sha256}.mp4`;
  await rename(temporary,join(output,file));
  manifest.clips[kind]={...manifest.clips[kind],file,sha256,bytes:bytes.length,encoding:seekable||ultra?{keyframeInterval,bFrames:0,streamCopy:ultra}:{keyframeInterval:60,bFrames:stream.has_b_frames,streamCopy:true}};
  console.log(`${file}: ${bytes.length} bytes`);
}
// Independent one-second 4K / two-second 1080p containers bound reverse-seek downloads.
// Stream-copy preserves every encoded picture, including section boundaries.
const sectionDir=await mkdtemp(join(output,'sections-'));
try{
  const result=spawnSync('ffmpeg',['-hide_banner','-loglevel','error','-y','-i',join(output,manifest.clips.journey.file),
    '-c','copy','-map','0:v:0','-f','segment','-segment_time',ultra?'1':'2','-reset_timestamps','1','-segment_format_options','movflags=+faststart',join(sectionDir,'part-%03d.mp4')],{stdio:'inherit'});
  if(result.error)throw result.error;
  if(result.status!==0)throw Error('Journey sectioning failed');
  let firstFrame=manifest.firstFrame,description;const segments=[];
  for(const part of (await readdir(sectionDir)).filter(file=>file.endsWith('.mp4')).sort()){
    const path=join(sectionDir,part);
    const probe=spawnSync('ffprobe',['-v','error','-count_frames','-show_packets','-show_entries','stream=nb_read_frames,width,height,r_frame_rate,has_b_frames:packet=pos,size,flags,pts_time','-of','json',path],{encoding:'utf8'});
    if(probe.status!==0)throw Error('Section probe failed');
    const parsed=JSON.parse(probe.stdout),[stream]=parsed.streams,frameCount=Number(stream.nb_read_frames);
    if(stream.width!==manifest.width||stream.height!==manifest.height||stream.r_frame_rate!=='60/1'||stream.has_b_frames!==0||!Number.isInteger(frameCount)||frameCount<1||frameCount>120)throw Error('Invalid video section');
    const bytes=await readFile(path),sha256=createHash('sha256').update(bytes).digest('hex'),file=`entrance-journey-${sha256}.mp4`;
    if(bytes.length>24*1024*1024)throw Error('Video section exceeds the browser buffer budget');
    const at=bytes.indexOf(Buffer.from('avcC'));
    if(at<4)throw Error('Missing AVC configuration');
    const length=bytes.readUInt32BE(at-4)-8,config=bytes.subarray(at+4,at+4+length).toString('hex');
    if(length<8||length>2048||description&&description!==config)throw Error('Inconsistent AVC configuration');
    description=config;
    const frames=parsed.packets.map((packet,i)=>{
      const key=packet.flags.includes('K');
      if(Math.abs(Number(packet.pts_time)-i/60)>.00001||key!==(i%keyframeInterval===0))throw Error('Unexpected section frame timing');
      return [Number(packet.pos),Number(packet.size),Number(key)];
    });
    if(frames.length!==frameCount)throw Error('Incomplete section frame index');
    await rename(path,join(output,file));
    segments.push({file,sha256,bytes:bytes.length,firstFrame,lastFrame:firstFrame+frameCount-1,frameCount,frames});firstFrame+=frameCount;
    console.log(`${file}: ${bytes.length} bytes`);
  }
  if(firstFrame!==manifest.lastFrame+1)throw Error('Incomplete journey sections');
  manifest.clips.journey.segments=segments;
  manifest.clips.journey.decoder={codec:'avc1.'+description.slice(2,8),description,keyframeInterval};
}finally{await rm(sectionDir,{recursive:true,force:true})}
// A small complete motion proxy keeps cold, fast scrolls responsive. The full
// resolution frame replaces it as soon as available, including every resting pose.
const previewPath=join(output,'preview.mp4');
const previewEncode=spawnSync('ffmpeg',['-hide_banner','-loglevel','error','-y','-i',join(work,ultra?'rendered/journey.mp4':'journey-master.mp4'),
  '-an','-vf','scale=512:288','-c:v','libx264','-preset','slow','-crf','24','-g','12','-keyint_min','12','-sc_threshold','0','-bf','0','-pix_fmt','yuv420p',
  '-color_primaries','bt709','-color_trc','bt709','-colorspace','bt709','-color_range','tv','-movflags','+faststart',previewPath],{stdio:'inherit'});
if(previewEncode.error||previewEncode.status!==0)throw Error('Motion preview encoding failed');
const previewProbe=spawnSync('ffprobe',['-v','error','-count_frames','-show_packets','-show_entries','stream=nb_read_frames,width,height,r_frame_rate,has_b_frames:packet=pos,size,flags,pts_time','-of','json',previewPath],{encoding:'utf8'});
if(previewProbe.status!==0)throw Error('Motion preview probe failed');
const previewParsed=JSON.parse(previewProbe.stdout),[previewStream]=previewParsed.streams;
if(previewStream.width!==512||previewStream.height!==288||previewStream.r_frame_rate!=='60/1'||previewStream.has_b_frames!==0||Number(previewStream.nb_read_frames)!==1831)throw Error('Invalid motion preview');
const previewBytes=await readFile(previewPath),previewHash=createHash('sha256').update(previewBytes).digest('hex');
if(previewBytes.length>12*1024*1024)throw Error('Motion preview exceeds its buffer budget');
const previewAt=previewBytes.indexOf(Buffer.from('avcC'));
if(previewAt<4)throw Error('Missing preview AVC configuration');
const previewDescription=previewBytes.subarray(previewAt+4,previewAt+4+previewBytes.readUInt32BE(previewAt-4)-8).toString('hex');
const previewFrames=previewParsed.packets.map((packet,i)=>{
  const key=packet.flags.includes('K');
  if(Math.abs(Number(packet.pts_time)-i/60)>.00001||key!==(i%12===0))throw Error('Unexpected preview timing');
  return [Number(packet.pos),Number(packet.size),Number(key)];
});
if(previewFrames.length!==1831)throw Error('Incomplete motion preview');
const previewFile=`entrance-journey-${previewHash}.mp4`;
await rename(previewPath,join(output,previewFile));
manifest.clips.journey.preview={file:previewFile,sha256:previewHash,bytes:previewBytes.length,width:512,height:288,firstFrame:334,lastFrame:2164,frameCount:1831,
  frames:previewFrames,decoder:{codec:'avc1.'+previewDescription.slice(2,8),description:previewDescription,keyframeInterval:12}};
console.log(`${previewFile}: ${previewBytes.length} bytes (motion preview)`);
const json=JSON.stringify(manifest,null,2)+'\n';
const file=`entrance-manifest-${createHash('sha256').update(json).digest('hex')}.json`;
await writeFile(join(output,file),json);
console.log(`Upload the opening, full journey and every journey section first, then ${file}. Set ${ultra?'ENTRANCE_VIDEO_4K_MANIFEST_URL':'ENTRANCE_VIDEO_MANIFEST_URL'} to its public HTTPS URL after verification.`);
