import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFile,writeFile,rename,rm} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve,join} from 'node:path';

// Iterate on web compression without rerendering the optimized scene.
const root=fileURLToPath(new URL('../',import.meta.url));
const work=resolve(root,'work/entrance-video'),output=resolve(root,'assets/entrance-video');
const manifest=JSON.parse(await readFile(join(output,'manifest.json'),'utf8'));
const crf=20,gop=24;
const metadataOnly=process.argv.includes('--metadata-only');
for(const kind of ['opening','journey']){
  const temporary=join(output,kind+'.download.mp4');
  try{
    await new Promise((resolve,reject)=>{
      const process=spawn('ffmpeg',['-hide_banner','-loglevel','error','-y','-i',metadataOnly?join(output,kind+'.mp4'):join(work,kind+'-master.mp4'),
        '-an',...(metadataOnly?['-c:v','copy']:['-c:v','libx264','-preset','slow','-crf',String(crf),'-g',String(gop),'-keyint_min',String(gop),'-sc_threshold','0','-bf','0']),
        '-bsf:v','h264_metadata=colour_primaries=1:transfer_characteristics=1:matrix_coefficients=1:video_full_range_flag=0',
        '-pix_fmt','yuv420p','-color_primaries','bt709','-color_trc','bt709','-colorspace','bt709','-color_range','tv','-movflags','+faststart',temporary],{stdio:'inherit'});
      process.once('error',reject);process.once('close',code=>code===0?resolve():reject(Error(`ffmpeg exited ${code}`)));
    });
    const bytes=await readFile(temporary);
    manifest.clips[kind]={...manifest.clips[kind],bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};
    await rename(temporary,join(output,kind+'.mp4'));
    console.log(`${kind}: ${(bytes.length/1e6).toFixed(2)} MB`);
  }finally{await rm(temporary,{force:true});}
}
if(!metadataOnly)manifest.encoding={...manifest.encoding,crf,keyframeInterval:gop};
await writeFile(join(output,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
