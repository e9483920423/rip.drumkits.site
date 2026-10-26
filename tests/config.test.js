import assert from 'node:assert/strict';
import test from 'node:test';
import { loadConfig } from '../src/config.js';

test('accepts a public bind without a token', () => {
  const config = loadConfig({ HOST: '0.0.0.0' }, process.cwd());
  assert.equal(config.host, '0.0.0.0');
});

test('rejects invalid numbers and overlapping directories', () => {
  assert.throws(() => loadConfig({ PORT: 'nope' }, process.cwd()), /PORT/);
  assert.throws(() => loadConfig({
    DATA_DIR: './data',
    DOWNLOAD_DIR: './data',
  }, process.cwd()), /DOWNLOAD_DIR/);
});
