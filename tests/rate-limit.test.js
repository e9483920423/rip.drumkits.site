import assert from 'node:assert/strict';
import test from 'node:test';
import { createRateLimiter, limitForPath } from '../src/services/rate-limit.js';

test('evicts oldest keys instead of wiping the map', () => {
  let time = 1_000;
  const allow = createRateLimiter({
    limit: 1,
    windowMs: 60_000,
    now: () => time,
    maxKeys: 2,
  });
  assert.equal(allow('a'), true);
  assert.equal(allow('b'), true);
  assert.equal(allow('a'), false);
  assert.equal(allow('c'), true);
  assert.equal(allow.size(), 2);
  assert.equal(allow('a'), true);
  assert.equal(allow('a'), false);
});

test('expired stamps are pruned before eviction', () => {
  let time = 1_000;
  const allow = createRateLimiter({
    limit: 1,
    windowMs: 100,
    now: () => time,
    maxKeys: 1,
  });
  assert.equal(allow('old'), true);
  time += 500;
  assert.equal(allow('new'), true);
  assert.equal(allow.size(), 1);
  assert.equal(allow('new'), false);
});

test('classifies inspect and download paths', () => {
  assert.equal(limitForPath('/api/media/info'), 'inspect');
  assert.equal(limitForPath('/api/media/download'), 'download');
  assert.equal(limitForPath('/api/media/download/abc'), 'download');
  assert.equal(limitForPath('/api/health'), 'general');
});
