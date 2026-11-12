import {readFile, readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

export const artworkRoot = fileURLToPath(new URL('../', import.meta.url));

export async function collectArtwork(root = artworkRoot) {
  const paths = new Set();
  async function scan(directory) {
    for (const entry of await readdir(resolve(root, directory), {withFileTypes: true})) {
      const name = `${directory}/${entry.name}`;
      if (entry.isDirectory()) await scan(name);
      else if (/\.(?:jsx?|tsx?|json|css)$/.test(name)) {
        const source = await readFile(resolve(root, name), 'utf8');
        for (const match of source.matchAll(/\/assets\/collective\/[a-f0-9]{20}\.(?:png|webp)/g)) paths.add(match[0].slice(1));
      }
    }
  }
  for (const directory of ['collective-source', 'account-source', 'game-source/src']) await scan(directory);
  return Promise.all([...paths].sort().map(async file => {
    const bytes = await readFile(resolve(root, file));
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    if (!file.includes(`/${sha256.slice(0,20)}.`)) throw Error(`Artwork filename does not match its content: ${file}`);
    return {file, key: file.replace(/^assets\//, 'artwork/'), bytes: bytes.length, sha256,
      contentType: file.endsWith('.webp') ? 'image/webp' : 'image/png'};
  }));
}
