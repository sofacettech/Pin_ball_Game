import {readFile,stat} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const bucket=process.env.R2_BUCKET;
if(!bucket||!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(bucket))throw Error('Set R2_BUCKET to the dedicated public video bucket.');
const assets=new URL('../assets/',import.meta.url);
const manifest=JSON.parse(await readFile(new URL('video-manifest.json',assets),'utf8'));
const objects=[...new Map(Object.values(manifest.variants).flatMap(variant=>[variant.journey,variant.opening]).map(asset=>[asset.key,asset])).values()];
// Validate every asset before the first upload so a stale manifest cannot poison immutable keys.
for(const object of objects){
 const file=new URL(object.file,assets),hash=createHash('sha256');
 for await(const chunk of createReadStream(file))hash.update(chunk);
 if(hash.digest('hex')!==object.sha256||(await stat(file)).size!==object.bytes)throw Error(`Run npm run build:frames first: ${object.file} changed.`);
 if(object.key!==`videos/${object.sha256}/${object.file}`)throw Error('Unexpected object key');
}
for(const object of objects){
 const args=['r2','object','put',`${bucket}/${object.key}`,'--remote','--file',fileURLToPath(new URL(object.file,assets)),
  '--content-type','video/mp4','--cache-control','public, max-age=31536000, immutable'];
 if(process.argv.includes('--dry-run')){console.log(JSON.stringify(args));continue}
 console.log(`Uploading ${object.file} (${object.bytes} bytes)`);
 const command=process.env.WRANGLER_JS?process.execPath:'npx';
 const prefix=process.env.WRANGLER_JS?[process.env.WRANGLER_JS]:['--yes','wrangler@4.151.2'];
 const result=spawnSync(command,[...prefix,...args],{stdio:'inherit',env:{...process.env,CLOUDFLARE_SEND_METRICS:'false'}});
 if(result.error)throw result.error;
 if(result.status!==0)throw Error(`R2 upload failed for ${object.file}`);
}
