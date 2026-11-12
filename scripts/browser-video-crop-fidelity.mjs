import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {visibleVideoCrop} from '../entrance-source/video-crop.mjs';

export async function verifyVideoCropPixels(browser,{drawMode='translated-full-image',inputKind='video-frame'}={}){
  const context=await browser.newContext(),page=await context.newPage();
  const framing=JSON.parse(await readFile(new URL('../assets/ball-framing.json',import.meta.url)));
  try{
    await page.addScriptTag({content:`window.__visibleVideoCrop=${visibleVideoCrop.toString()};`});
    const result=await page.evaluate(async({framing,drawMode,inputKind})=>{
      const sw=3840,sh=2160,source=document.createElement('canvas');source.width=sw;source.height=sh;
      const input=source.getContext('2d',{alpha:false}),image=input.createImageData(sw,sh),pixels=new Uint32Array(image.data.buffer);
      // Single-pixel features reveal an accidental lower-resolution backing or
      // a changed resampling phase, alongside gradients and coordinate bands.
      for(let y=0;y<sh;y++)for(let x=0;x<sw;x++){
        const r=(x*13+y*3)&255,g=((x^y)&1)?240:16,b=((x>>5)^(y>>5))&255;
        pixels[y*sw+x]=(255<<24)|(b<<16)|(g<<8)|r;
      }
      input.putImageData(image,0,0);
      if(typeof VideoFrame!=='function')throw Error('VideoFrame required for crop fidelity verification');
      const frame=new VideoFrame(source,{timestamp:0,alpha:'discard'});
      const drawable=inputKind==='canvas'?source:inputKind==='image-bitmap'?await createImageBitmap(frame):frame;
      const full=document.createElement('canvas');full.width=sw;full.height=sh;full.getContext('2d',{alpha:false}).drawImage(drawable,0,0);
      const checks=[];
      try{for(const [name,width,height,at] of [['portrait-opening',393,695,334],['portrait-moving',393,695,850.5],['landscape-rotation',900,393,1840],['portrait-final',393,695,2164]]){
        const i=Math.floor(at),j=Math.min(i+1,framing.points.length-1),focus=framing.points[i].map((v,n)=>v+(framing.points[j][n]-v)*(at-i));
        const scale=Math.max(width/1920,height/1080),fullWidth=1920*scale,fullHeight=1080*scale;
        const x=Math.max(width-fullWidth,Math.min(0,width/2-focus[0]*fullWidth)),y=Math.max(height-fullHeight,Math.min(0,height/2-focus[1]*fullHeight));
        const crop=window.__visibleVideoCrop(sw,sh,{fullWidth,fullHeight,x:-x,y:-y,width,height});
        const cropped=document.createElement('canvas');cropped.width=crop.width;cropped.height=crop.height;
        const cropContext=cropped.getContext('2d',{alpha:false});
        if(drawMode==='translated-full-image')cropContext.drawImage(drawable,-crop.x,-crop.y);
        else cropContext.drawImage(drawable,crop.x,crop.y,crop.width,crop.height,0,0,crop.width,crop.height);
        const nativeSamples=[[0,0],[Math.floor(crop.width/2),Math.floor(crop.height/2)],[crop.width-1,crop.height-1]].map(([x,y])=>({x,y,
          full:Array.from(full.getContext('2d').getImageData(crop.x+x,crop.y+y,1,1).data),
          cropped:Array.from(cropContext.getImageData(x,y,1,1).data)}));
        const dpr=3,reference=document.createElement('canvas'),actual=document.createElement('canvas');
        reference.width=actual.width=width*dpr;reference.height=actual.height=height*dpr;
        const expectedContext=reference.getContext('2d',{alpha:false}),actualContext=actual.getContext('2d',{alpha:false});
        expectedContext.drawImage(full,x*dpr,y*dpr,fullWidth*dpr,fullHeight*dpr);
        actualContext.drawImage(cropped,crop.cssX*dpr,crop.cssY*dpr,crop.cssWidth*dpr,crop.cssHeight*dpr);
        const a=expectedContext.getImageData(0,0,reference.width,reference.height).data,b=actualContext.getImageData(0,0,actual.width,actual.height).data;
        let maxChannelError=0,totalError=0,squaredError=0,pixelsOverTwo=0,pixelsDifferent=0;
        for(let k=0;k<a.length;k+=4){let peak=0;for(let c=0;c<3;c++){const error=Math.abs(a[k+c]-b[k+c]);peak=Math.max(peak,error);totalError+=error;squaredError+=error*error;}maxChannelError=Math.max(maxChannelError,peak);if(peak>2)pixelsOverTwo++;if(peak)pixelsDifferent++;}
        let images;
        if(name==='portrait-opening'){
          const diff=document.createElement('canvas');diff.width=actual.width;diff.height=actual.height;
          const ctx=diff.getContext('2d'),data=ctx.createImageData(diff.width,diff.height);
          for(let k=0;k<a.length;k+=4){for(let c=0;c<3;c++)data.data[k+c]=Math.min(255,Math.abs(a[k+c]-b[k+c])*4);data.data[k+3]=255;}
          ctx.putImageData(data,0,0);images={full:reference.toDataURL(),cropped:actual.toDataURL(),diff:diff.toDataURL()};diff.width=diff.height=0;
        }
        checks.push({name,source:[sw,sh],viewport:[width,height],dpr,frame:at,crop,nativeSamples,
          comparedPixels:a.length/4,maxChannelError,meanChannelError:totalError/(a.length/4*3),rmsChannelError:Math.sqrt(squaredError/(a.length/4*3)),pixelsOverTwo,
          fractionOverTwo:pixelsOverTwo/(a.length/4),fractionDifferent:pixelsDifferent/(a.length/4),images,sourcePixelsPerBackingPixel:1});
        cropped.width=cropped.height=reference.width=reference.height=actual.width=actual.height=0;
      }}finally{if(inputKind==='image-bitmap')drawable.close();frame.close();source.width=source.height=full.width=full.height=0;}
      return {drawMode,inputKind,method:'Actual 4K source, full and cropped 2D backing projected at DPR3; synthetic pixels isolate source crop, filtering and sharpness from H264 decode',checks};
    },{framing,drawMode,inputKind});
    const output=new URL('../work/video-crop-fidelity/',import.meta.url);
    await mkdir(output,{recursive:true});
    const prefix=`${browser.browserType().name()}-${inputKind}-${drawMode}`;
    for(const check of result.checks)if(check.images){
      check.artifacts={};
      for(const [name,dataURL] of Object.entries(check.images)){
        const file=new URL(`${prefix}-${check.name}-${name}.png`,output);
        await writeFile(file,Buffer.from(dataURL.split(',')[1],'base64'));check.artifacts[name]=file.pathname;
      }
      delete check.images;
    }
    await writeFile(new URL(`${prefix}.json`,output),JSON.stringify(result,null,2)+'\n');
    for(const check of result.checks){
      assert.ok(check.maxChannelError<=2,`${check.name}: channel error ${check.maxChannelError}; mean ${check.meanChannelError}; native ${JSON.stringify(check.nativeSamples)}`);
      assert.ok(check.meanChannelError<=.15,`${check.name}: mean error ${check.meanChannelError}`);
      assert.equal(check.pixelsOverTwo,0,`${check.name}: visible pixels differ beyond rounding tolerance`);
    }
    return result;
  }finally{await context.close()}
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const require=createRequire(import.meta.url),engine=process.env.SOFACET_BROWSER||'chromium';
  const {[engine]:type}=require(process.env.SOFACET_PLAYWRIGHT_PATH||'playwright');
  const browser=await type.launch(engine==='chromium'&&process.platform==='darwin'?{args:['--enable-gpu']}:{});
  try{
    const result=await verifyVideoCropPixels(browser,{drawMode:process.env.SOFACET_CROP_DRAW_MODE||'translated-full-image',inputKind:process.env.SOFACET_CROP_INPUT_KIND||'video-frame'}),output=new URL('../work/video-crop-fidelity/',import.meta.url);
    await mkdir(output,{recursive:true});await writeFile(new URL(`${engine}.json`,output),JSON.stringify(result,null,2)+'\n');
    console.log(JSON.stringify({engine,...result}));
  }finally{await browser.close()}
}
