import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function copyLicense(pkgName, destDir) {
  const pkgDir = path.join(root, 'node_modules', ...pkgName.split('/'));
  fs.mkdirSync(destDir, { recursive: true });
  for (const name of ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'license']) {
    const src = path.join(pkgDir, name);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, path.join(destDir, 'LICENSE'));
      return;
    }
  }
  const pkg = JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf8'));
  fs.writeFileSync(path.join(destDir, 'LICENSE'), `${pkg.name} ${pkg.license || 'MIT'}\n`);
}

async function bundle(outfile, source, extra = {}) {
  fs.mkdirSync(path.dirname(outfile), { recursive: true });
  await esbuild.build({
    stdin: {
      contents: source,
      resolveDir: root,
      sourcefile: path.basename(outfile),
    },
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    outfile,
    legalComments: 'none',
    logLevel: 'warning',
    ...extra,
  });
}

const mp3tagSrc = path.join(root, 'node_modules', 'mp3tag.js', 'dist', 'mp3tag.mjs');
if (!fs.existsSync(mp3tagSrc)) {
  console.warn('vendor-audio: mp3tag.js is not installed; skipping');
  process.exit(0);
}

const mp3tagDest = path.join(root, 'public', 'vendor', 'mp3tag');
copyLicense('mp3tag.js', mp3tagDest);
fs.copyFileSync(mp3tagSrc, path.join(mp3tagDest, 'mp3tag.js'));

const loudnessDest = path.join(root, 'public', 'vendor', 'loudness');
copyLicense('@audio/loudness', loudnessDest);
await bundle(
  path.join(loudnessDest, 'loudness.js'),
  "export { lufs, truepeak, lra, replaygain } from '@audio/loudness';\n",
);

const metaDest = path.join(root, 'public', 'vendor', 'music-metadata');
copyLicense('music-metadata', metaDest);
await bundle(
  path.join(metaDest, 'music-metadata.js'),
  "export { parseBlob } from 'music-metadata';\n",
  { conditions: ['browser', 'default', 'import'] },
);

console.log('vendor-audio: wrote public/vendor/{mp3tag,loudness,music-metadata}');
