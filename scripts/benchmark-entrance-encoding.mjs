import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdir,readFile,writeFile,stat} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';

// Offline experiment only. This never modifies a production manifest or uploads
// assets. Supply an original render/high-quality saved master, not a CDN movie.
export const ENCODING_MATRIX=[
  {name:'g12-r5',gop:12,refs:5},
  {name:'g4-r5',gop:4,refs:5},
  {name:'g12-r2',gop:12,refs:2},
  {name:'g4-r2',gop:4,refs:2},
];
export const ENCODING_SAMPLES=[
  {name:'ball',firstFrame:334,frameCount:60},
  {name:'diamond',firstFrame:850,frameCount:60},
  {name:'doorway',firstFrame:1480,frameCount:60},
];

function run(command,args){
  const result=spawnSync(command,args,{encoding:'utf8',maxBuffer:16*1024*1024});
  if(result.error)throw result.error;
  if(result.status!==0)throw Error(`${command} failed: ${result.stderr.slice(-3000)}`);
  return result;
}
const probe=path=>JSON.parse(run('ffprobe',['-v','error','-show_packets','-show_streams','-of','json',path]).stdout);
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');

// Reject a broken frame index before the existing production decoder sees it.
// FFprobe packet offsets address the original MP4 bytes, not Annex B samples.
export function indexEncoding(bytes,{streams,packets},gop,frameCount){
  if(![4,12].includes(gop)||!Number.isInteger(frameCount)||frameCount<1)throw Error('Invalid encoding index settings');
  const stream=streams?.find(stream=>stream.codec_type==='video');
  if(!stream||stream.codec_name!=='h264'||stream.width!==3840||stream.height!==2160||
    stream.r_frame_rate!=='60/1'||stream.has_b_frames!==0||packets?.length!==frameCount||
    ['color_primaries','color_transfer','color_space'].some(key=>stream[key]!=='bt709'))throw Error('Unexpected encoded video format');
  const frames=packets.map((packet,i)=>{
    const offset=Number(packet.pos),length=Number(packet.size),key=packet.flags?.includes('K'),pts=Number(packet.pts_time),dts=Number(packet.dts_time);
    if(!Number.isInteger(offset)||!Number.isInteger(length)||offset<0||length<1||offset+length>bytes.length||
      !Number.isFinite(pts)||!Number.isFinite(dts)||Math.abs(pts-i/60)>.00001||Math.abs(dts-i/60)>.00001||
      key!==(i%gop===0))throw Error(`Invalid encoded packet ${i}`);
    if(i&&offset<Number(packets[i-1].pos)+Number(packets[i-1].size))throw Error('Overlapping encoded packets');
    return [offset,length,Number(key)];
  });
  const at=bytes.indexOf(Buffer.from('avcC'));
  if(at<4)throw Error('Missing AVC configuration');
  const length=bytes.readUInt32BE(at-4)-8;
  if(length<8||length>2048||at+4+length>bytes.length)throw Error('Invalid AVC configuration');
  const description=bytes.subarray(at+4,at+4+length).toString('hex');
  return {frames,decoder:{codec:'avc1.'+description.slice(2,8),description,keyframeInterval:gop}};
}

export async function encodeMatrix({master,sourceKind,output,crf=18}){
  if(!['original-render','saved-master'].includes(sourceKind))throw Error('Choose --source-kind original-render or saved-master');
  if(!master)throw Error('Supply --master with the original render or high-quality master');
  if(!Number.isInteger(crf)||crf<0||crf>30)throw Error('CRF must be an integer from 0 to 30');
  master=resolve(master);output=resolve(output);
  // Output stays separate even when the master lives in an older work folder.
  if(master.startsWith(output+'/'))throw Error('The output directory must not contain the source master');
  const source=probe(master).streams.find(stream=>stream.codec_type==='video');
  if(source?.width!==3840||source?.height!==2160||source?.r_frame_rate!=='60/1'||!Number.isInteger(Number(source.nb_frames))||Number(source.nb_frames)<1206)throw Error('A native 4K 60 fps journey master starting at frame 334 is required');
  await mkdir(output,{recursive:true});
  const sourceBytes=await readFile(master);
  const report={version:1,createdAt:new Date().toISOString(),purpose:'Short samples; not a production media selection',
    source:{path:master,kind:sourceKind,sha256:digest(sourceBytes),bytes:sourceBytes.length,firstFrame:334,
      note:'Quality scores compare with decoded master samples. A saved lossy master is not a lossless original or a comparison with the deployed encode.'},
    settings:{width:3840,height:2160,fps:60,crf,preset:'slow',bFrames:0,pixelFormat:'yuv420p',colorSpace:'bt709',
      preloadBudgetBytes:256*1024*1024},samples:[]};
  for(const sample of ENCODING_SAMPLES){
    const reference=join(output,sample.name+'-reference.mkv'),start=sample.firstFrame-334;
    // FFV1 preserves the decoded master's pixels across all four encode arms.
    run('ffmpeg',['-hide_banner','-loglevel','error','-y','-i',master,'-an','-vf',`trim=start_frame=${start}:end_frame=${start+sample.frameCount},setpts=PTS-STARTPTS`,
      '-c:v','ffv1','-level','3','-g','1','-pix_fmt','yuv420p','-color_primaries','bt709','-color_trc','bt709','-colorspace','bt709','-color_range','tv',reference]);
    const record={...sample,reference:sample.name+'-reference.mkv',referenceBytes:(await stat(reference)).size,variants:[]};
    for(const variant of ENCODING_MATRIX){
      const file=`${sample.name}-${variant.name}.mp4`,path=join(output,file),began=performance.now();
      run('ffmpeg',['-hide_banner','-loglevel','error','-y','-i',reference,'-an','-c:v','libx264','-preset','slow','-crf',String(crf),
        '-g',String(variant.gop),'-keyint_min',String(variant.gop),'-sc_threshold','0','-bf','0','-refs',String(variant.refs),
        '-pix_fmt','yuv420p','-bsf:v','h264_metadata=colour_primaries=1:transfer_characteristics=1:matrix_coefficients=1:video_full_range_flag=0',
        '-color_primaries','bt709','-color_trc','bt709','-colorspace','bt709','-color_range','tv','-movflags','+faststart',path]);
      const encodeMs=performance.now()-began,bytes=await readFile(path),indexed=indexEncoding(bytes,probe(path),variant.gop,sample.frameCount);
      const quality=run('ffmpeg',['-hide_banner','-i',path,'-i',reference,'-lavfi','[0:v][1:v]ssim','-f','null','-']).stderr;
      const ssim=Number(/All:([\d.]+)/.exec(quality)?.[1]);
      if(!Number.isFinite(ssim))throw Error('SSIM measurement failed');
      const headers=run('ffmpeg',['-hide_banner','-loglevel','info','-i',path,'-c','copy','-bsf:v','trace_headers','-frames:v','1','-f','null','-']).stderr;
      const actualRefs=Number(/max_num_ref_frames\s+\S+ = (\d+)/.exec(headers)?.[1]);
      if(actualRefs!==variant.refs)throw Error(`Unexpected reference picture limit ${actualRefs}`);
      record.variants.push({...variant,file,bytes:bytes.length,sha256:digest(bytes),encodeMs,ssim,actualRefs,...indexed});
      console.log(`${sample.name} ${variant.name}: ${bytes.length} bytes, SSIM ${ssim}`);
      // Persist after each arm so a long encode can resume review without a
      // misleading claim that the complete experiment finished.
      await writeFile(join(output,'manifest.json'),JSON.stringify({...report,samples:[...report.samples,record],complete:false},null,2)+'\n');
    }
    report.samples.push(record);
  }
  report.complete=true;
  await writeFile(join(output,'manifest.json'),JSON.stringify(report,null,2)+'\n');
  return report;
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const {values}=parseArgs({options:{master:{type:'string'},'source-kind':{type:'string'},output:{type:'string',default:'work/entrance-encoding'},crf:{type:'string',default:'18'}}});
  await encodeMatrix({master:values.master,sourceKind:values['source-kind'],output:values.output,crf:Number(values.crf)});
}
