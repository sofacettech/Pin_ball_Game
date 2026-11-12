import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
import {collectArtwork, artworkRoot} from './artwork-manifest.mjs';

const bucket = process.env.R2_BUCKET;
if (!bucket || !/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(bucket)) throw Error('Set R2_BUCKET to the existing public media bucket.');
// Validate every local hash before writing any immutable object.
const objects = await collectArtwork();
for (const object of objects) {
  if (process.argv.includes('--dry-run')) {console.log(JSON.stringify(object)); continue;}
  const command = process.env.WRANGLER_JS ? process.execPath : 'npx';
  const prefix = process.env.WRANGLER_JS ? [process.env.WRANGLER_JS] : ['--yes', 'wrangler@4.151.2'];
  const result = spawnSync(command, [...prefix, 'r2', 'object', 'put', `${bucket}/${object.key}`, '--remote',
    '--file', resolve(artworkRoot, object.file), '--content-type', object.contentType,
    '--cache-control', 'public, max-age=31536000, immutable'], {stdio:'inherit', env:{...process.env, CLOUDFLARE_SEND_METRICS:'false'}});
  if (result.error) throw result.error;
  if (result.status !== 0) throw Error(`R2 artwork upload failed: ${object.file}`);
}
