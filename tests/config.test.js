import assert from 'node:assert/strict';
import test from 'node:test';
import { accessTokenRequired, loadConfig } from '../src/config.js';

test('accepts a public bind without a token', () => {
  const config = loadConfig({ HOST: '0.0.0.0' }, process.cwd());
  assert.equal(config.host, '0.0.0.0');
  assert.equal(config.spotdlPath, 'spotdl');
  assert.equal(config.accessToken, '');
  assert.equal(accessTokenRequired(config), false);
  assert.equal(config.rateLimitInspectPerMinute, 30);
  assert.equal(config.rateLimitDownloadPerMinute, 10);
  assert.equal(config.minFreeDiskMb, 512);
});

test('requires ACCESS_TOKEN only on non-loopback binds', () => {
  const token = 'shared-secret-16';
  const publicHost = loadConfig({ HOST: '0.0.0.0', ACCESS_TOKEN: token }, process.cwd());
  assert.equal(publicHost.accessToken, token);
  assert.equal(accessTokenRequired(publicHost), true);
  const loopback = loadConfig({ HOST: '127.0.0.1', ACCESS_TOKEN: token }, process.cwd());
  assert.equal(accessTokenRequired(loopback), false);
  assert.throws(() => loadConfig({ ACCESS_TOKEN: 'short' }, process.cwd()), /ACCESS_TOKEN/);
  assert.throws(() => loadConfig({ ACCESS_TOKEN: 'token with spaces!!!!' }, process.cwd()), /ACCESS_TOKEN/);
});

test('rejects invalid numbers and overlapping directories', () => {
  assert.throws(() => loadConfig({ PORT: 'nope' }, process.cwd()), /PORT/);
  assert.throws(() => loadConfig({
    DATA_DIR: './data',
    DOWNLOAD_DIR: './data',
  }, process.cwd()), /DOWNLOAD_DIR/);
});
