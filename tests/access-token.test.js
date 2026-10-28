import assert from 'node:assert/strict';
import test from 'node:test';
import { accessTokenMatches, readAccessToken } from '../src/services/access-token.js';

test('reads access tokens from headers and query', () => {
  assert.equal(readAccessToken({ headers: { 'x-access-token': ' abc ' }, query: {} }), 'abc');
  assert.equal(readAccessToken({
    headers: { authorization: 'Bearer secret-value' },
    query: {},
  }), 'secret-value');
  assert.equal(readAccessToken({ headers: {}, query: { token: 'from-query' } }), 'from-query');
  assert.equal(readAccessToken({ headers: {}, query: {} }), '');
});

test('compares tokens in constant time after hashing', () => {
  assert.equal(accessTokenMatches('', ''), true);
  assert.equal(accessTokenMatches('same-token', 'same-token'), true);
  assert.equal(accessTokenMatches('left-token', 'right-token'), false);
  assert.equal(accessTokenMatches('', 'expected-token'), false);
});
