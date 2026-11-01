import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdir,mkdtemp,readFile,readdir,writeFile,rename,rm} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';

// Keep the high-quality renders outside Git and the application deployment.
// The opening plays normally. The scroll movie needs short prediction chains
// and no B frames so reverse seeking does not stall Safari's decoder.
const root=fileURLToPath(new URL('../',import.meta.url));
const output=join(root,'work/entrance-video/cdn');
await mkdir(output,{recursive:true});
const manifest=JSON.parse(await readFile(join(root,'assets/entrance-video/manifest.json'),'utf8'));
manifest.encoding={codec:'h264',crf:10,pixelFormat:'yuv420p',colorSpace:'bt709',fastStart:true,source:'saved-master'};
for(const kind of ['opening','journey']){
  const seekable=kind==='journey';
  const temporary=join(output,kind+'.mp4');
  const result=spawnSync('ffmpeg',['-hide_banner','-loglevel','error','-y','-i',join(root,`work/entrance-video/${kind}-master.mp4`),
    '-an',...(seekable?['-c:v','libx264','-preset','slow','-crf','10','-g','4','-keyint_min','4','-sc_threshold','0','-bf','0','-pix_fmt','yuv420p']:['-c:v','copy']),
    '-bsf:v','h264_metadata=colour_primaries=1:transfer_characteristics=1:matrix_coefficients=1:video_full_range_flag=0',
    '-color_primaries','bt709','-color_trc','bt709','-colorspace','bt709','-color_range','tv','-movflags','+faststart',temporary],{stdio:'inherit'});
  if(result.error)throw result.error;
  if(result.status!==0)throw Error(`ffmpeg failed for ${kind}`);
  const probe=spawnSync('ffprobe',['-v','error','-count_frames','-show_entries','stream=codec_name,width,height,r_frame_rate,nb_read_frames,has_b_frames,color_primaries,color_transfer,color_space','-of','json',temporary],{encoding:'utf8'});
  if(probe.status!==0)throw Error(`ffprobe failed for ${kind}`);
  const [stream]=JSON.parse(probe.stdout).streams;
  if(stream.codec_name!=='h264'||stream.width!==1920||stream.height!==1080||stream.r_frame_rate!=='60/1'||Number(stream.nb_read_frames)!==manifest.clips[kind].frameCount||
    ['color_primaries','color_transfer','color_space'].some(key=>stream[key]!=='bt709')||seekable&&stream.has_b_frames!==0)throw Error(`Invalid ${kind} master`);
  const bytes=await readFile(temporary),sha256=createHash('sha256').update(bytes).digest('hex');
  const file=`entrance-${kind}-${sha256}.mp4`;
  await rename(temporary,join(output,file));
  manifest.clips[kind]={...manifest.clips[kind],file,sha256,bytes:bytes.length,encoding:seekable?{keyframeInterval:4,bFrames:0,streamCopy:false}:{keyframeInterval:60,bFrames:stream.has_b_frames,streamCopy:true}};
  console.log(`${file}: ${bytes.length} bytes`);
}
// Independent two-second containers keep reverse seeks local to a small blob.
// Stream-copy preserves every encoded picture, including section boundaries.
const sectionDir=await mkdtemp(join(output,'sections-'));
try{
  const result=spawnSync('ffmpeg',['-hide_banner','-loglevel','error','-y','-i',join(output,manifest.clips.journey.file),
    '-c','copy','-map','0:v:0','-f','segment','-segment_time','2','-reset_timestamps','1','-segment_format_options','movflags=+faststart',join(sectionDir,'part-%03d.mp4')],{stdio:'inherit'});
  if(result.error)throw result.error;
  if(result.status!==0)throw Error('Journey sectioning failed');
  let firstFrame=manifest.firstFrame;const segments=[];
  for(const part of (await readdir(sectionDir)).filter(file=>file.endsWith('.mp4')).sort()){
    const path=join(sectionDir,part);
    const probe=spawnSync('ffprobe',['-v','error','-count_frames','-show_entries','stream=nb_read_frames,width,height,r_frame_rate,has_b_frames','-of','json',path],{encoding:'utf8'});
    if(probe.status!==0)throw Error('Section probe failed');
    const [stream]=JSON.parse(probe.stdout).streams,frameCount=Number(stream.nb_read_frames);
    if(stream.width!==1920||stream.height!==1080||stream.r_frame_rate!=='60/1'||stream.has_b_frames!==0||!Number.isInteger(frameCount)||frameCount<1||frameCount>120)throw Error('Invalid video section');
    const bytes=await readFile(path),sha256=createHash('sha256').update(bytes).digest('hex'),file=`entrance-journey-${sha256}.mp4`;
    if(bytes.length>24*1024*1024)throw Error('Video section exceeds the browser buffer budget');
    await rename(path,join(output,file));
    segments.push({file,sha256,bytes:bytes.length,firstFrame,lastFrame:firstFrame+frameCount-1,frameCount});firstFrame+=frameCount;
    console.log(`${file}: ${bytes.length} bytes`);
  }
  if(firstFrame!==manifest.lastFrame+1)throw Error('Incomplete journey sections');
  manifest.clips.journey.segments=segments;
}finally{await rm(sectionDir,{recursive:true,force:true})}
const json=JSON.stringify(manifest,null,2)+'\n';
const file=`entrance-manifest-${createHash('sha256').update(json).digest('hex')}.json`;
await writeFile(join(output,file),json);
console.log(`Upload the opening, full journey and every journey section first, then ${file}. Set ENTRANCE_VIDEO_MANIFEST_URL to its public HTTPS URL after verification.`);
