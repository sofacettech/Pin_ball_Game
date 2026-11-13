// Run with Node and Python 3 + Pillow (WebP support). Derivatives are committed;
// deployment builds do not need the image tooling. Resizing uses premultiplied
// RGBA/Lanczos; lossless WebP adds no further color or alpha quantization.
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const sources = {
  '/assets/collective/5524d041c1516421d04c.webp': 'launch',
  '/assets/collective/2e6a9ce5c7392808ab66.webp': 'launch',
  '/assets/collective/a8ee8d97a208cbbc8877.webp': 'launch',
  '/assets/collective/0888e17491315612fc37.webp': 'rewards',
  '/assets/collective/92ed03623561a36c7313.webp': 'rewards',
  '/assets/collective/573615f1db8ad0c5bd97.webp': 'rewards',
};
const result = spawnSync(process.env.PYTHON || 'python3', ['-c', `
from PIL import Image, features
from pathlib import Path
from io import BytesIO
import hashlib, json, sys

root = Path(sys.argv[1])
sources = json.load(sys.stdin)
manifest = {}
for source, layout in sources.items():
    path = root / source.lstrip('/')
    data = path.read_bytes()
    assert hashlib.sha256(data).hexdigest().startswith(path.stem), source
    image = Image.open(path).convert('RGBA')
    variants = []
    for width in [320, 480, 640, 960, 1280, 1600, 1920, 2560]:
        if width >= image.width:
            continue
        height = round(image.height * width / image.width)
        resized = image.resize((width, height), Image.Resampling.LANCZOS)
        output = BytesIO()
        resized.save(output, format='WEBP', lossless=True, method=6, exact=True)
        encoded = output.getvalue()
        # An additional candidate must save transfer bytes as well as pixels.
        if len(encoded) >= len(data):
            continue
        name = hashlib.sha256(encoded).hexdigest()[:20] + '.webp'
        destination = path.with_name(name)
        destination.write_bytes(encoded)
        variants.append({'src': '/assets/collective/' + name, 'width': width, 'height': height, 'bytes': len(encoded)})
    variants.append({'src': source, 'width': image.width, 'height': image.height, 'bytes': len(data)})
    manifest[source] = {'layout': layout, 'variants': variants}
target = root / 'collective-source/artwork/flower-variants.json'
target.write_text(json.dumps(manifest, indent=2) + '\\n')
print(json.dumps({'sources': len(manifest), 'derivatives': sum(len(v['variants'])-1 for v in manifest.values()), 'derivativeBytes': sum(c['bytes'] for v in manifest.values() for c in v['variants'][:-1]), 'pillowWebP': features.version('webp')}))
`, root], {input:JSON.stringify(sources), encoding:'utf8', maxBuffer:1024 * 1024});
if (result.error) throw result.error;
if (result.status !== 0) throw Error(result.stderr || 'Flower variant generation failed');
process.stdout.write(result.stdout);
