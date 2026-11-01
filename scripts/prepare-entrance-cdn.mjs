import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdir,readFile,writeFile,rename} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';

// Keep the high-quality renders outside Git and the application deployment.
// Stream-copy the encoded pictures; only correct colour metadata and move the MP4 index.
const root=fileURLToPath(new URL('../',import.meta.url));
const output=join(root,'work/entrance-video/cdn');
await mkdir(output,{recursive:true});
const manifest=JSON.parse(await readFile(join(root,'assets/entrance-video/manifest.json'),'utf8'));
manifest.encoding={...manifest.encoding,crf:10,keyframeInterval:60,source:'saved-master',streamCopy:true};
for(const kind of ['opening','journey']){
  const temporary=join(output,kind+'.mp4');
  const result=spawnSync('ffmpeg',['-hide_banner','-loglevel','error','-y','-i',join(root,`work/entrance-video/${kind}-master.mp4`),
    '-an','-c:v','copy','-bsf:v','h264_metadata=colour_primaries=1:transfer_characteristics=1:matrix_coefficients=1:video_full_range_flag=0',
    '-color_primaries','bt709','-color_trc','bt709','-colorspace','bt709','-color_range','tv','-movflags','+faststart',temporary],{stdio:'inherit'});
  if(result.error)throw result.error;
  if(result.status!==0)throw Error(`ffmpeg failed for ${kind}`);
  const probe=spawnSync('ffprobe',['-v','error','-count_frames','-show_entries','stream=codec_name,width,height,r_frame_rate,nb_read_frames,color_primaries,color_transfer,color_space','-of','json',temporary],{encoding:'utf8'});
  if(probe.status!==0)throw Error(`ffprobe failed for ${kind}`);
  const [stream]=JSON.parse(probe.stdout).streams;
  if(stream.codec_name!=='h264'||stream.width!==1920||stream.height!==1080||stream.r_frame_rate!=='60/1'||Number(stream.nb_read_frames)!==manifest.clips[kind].frameCount||
    ['color_primaries','color_transfer','color_space'].some(key=>stream[key]!=='bt709'))throw Error(`Invalid ${kind} master`);
  const bytes=await readFile(temporary),sha256=createHash('sha256').update(bytes).digest('hex');
  const file=`entrance-${kind}-${sha256}.mp4`;
  await rename(temporary,join(output,file));
  manifest.clips[kind]={...manifest.clips[kind],file,sha256,bytes:bytes.length};
  console.log(`${file}: ${bytes.length} bytes`);
}
const json=JSON.stringify(manifest,null,2)+'\n';
const file=`entrance-manifest-${createHash('sha256').update(json).digest('hex')}.json`;
await writeFile(join(output,file),json);
console.log(`Upload the two MP4 files first, then ${file}. Set ENTRANCE_VIDEO_MANIFEST_URL to its public HTTPS URL after verification.`);
