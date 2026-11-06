import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkgDir = path.join(root, 'node_modules', '@libraz', 'libsonare');
const dest = path.join(root, 'public', 'vendor', 'libsonare');
const wasm = path.join(pkgDir, 'dist', 'sonare-analysis.wasm');

if (!fs.existsSync(wasm)) {
  console.warn('vendor-libsonare: @libraz/libsonare is not installed; skipping');
  process.exit(0);
}

fs.mkdirSync(dest, { recursive: true });
for (const file of ['analysis.js', 'sonare-analysis.js', 'sonare-analysis.wasm']) {
  fs.copyFileSync(path.join(pkgDir, 'dist', file), path.join(dest, file));
}
fs.copyFileSync(path.join(pkgDir, 'NOTICE'), path.join(dest, 'NOTICE'));

const licenseSrc = path.join(pkgDir, 'LICENSE');
if (fs.existsSync(licenseSrc)) {
  fs.copyFileSync(licenseSrc, path.join(dest, 'LICENSE'));
} else {
  fs.writeFileSync(path.join(dest, 'LICENSE'), [
    '@libraz/libsonare',
    'Copyright 2024 libsonare contributors',
    '',
    'Licensed under the Apache License, Version 2.0 (the "License");',
    'you may not use this file except in compliance with the License.',
    'You may obtain a copy of the License at',
    '',
    '    http://www.apache.org/licenses/LICENSE-2.0',
    '',
    'Unless required by applicable law or agreed to in writing, software',
    'distributed under the License is distributed on an "AS IS" BASIS,',
    'WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.',
    'See the License for the specific language governing permissions and',
    'limitations under the License.',
    '',
    'Third-party notices for this build are in NOTICE.',
    '',
  ].join('\n'));
}

console.log(`vendor-libsonare: copied analysis build to ${path.relative(root, dest)}`);
