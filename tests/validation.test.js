import assert from 'node:assert/strict';
import test from 'node:test';
import { isPublicAddress, parseMediaUrl, createValidation } from '../src/services/validation.js';
import { publicLookup } from './helpers.js';

const VIDEO = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';

test('accepts single YouTube and SoundCloud items and canonicalizes them', () => {
  assert.equal(parseMediaUrl(VIDEO).url, VIDEO);
  assert.equal(parseMediaUrl(VIDEO).kind, 'video');
  assert.equal(parseMediaUrl('https://youtu.be/dQw4w9WgXcQ').url, VIDEO);
  assert.equal(parseMediaUrl('https://music.youtube.com/shorts/dQw4w9WgXcQ?feature=share').url, VIDEO);
  assert.equal(parseMediaUrl('http://m.youtube.com/watch?v=dQw4w9WgXcQ&list=PL123').url, VIDEO);
  assert.equal(parseMediaUrl('http://m.youtube.com/watch?v=dQw4w9WgXcQ&list=PL123').kind, 'video');
  assert.equal(
    parseMediaUrl('https://soundcloud.com/artist/track-name').url,
    'https://soundcloud.com/artist/track-name',
  );
  assert.equal(parseMediaUrl('https://on.soundcloud.com/abc123').source, 'soundcloud');
});

test('accepts YouTube playlists and SoundCloud sets', () => {
  const playlist = parseMediaUrl('https://music.youtube.com/playlist?list=PLfakelist1234567890123456789012');
  assert.equal(playlist.kind, 'playlist');
  assert.equal(playlist.source, 'youtube');
  assert.equal(playlist.url, 'https://www.youtube.com/playlist?list=PLfakelist1234567890123456789012');
  const set = parseMediaUrl('https://soundcloud.com/artist/sets/album-name');
  assert.equal(set.kind, 'playlist');
  assert.equal(set.source, 'soundcloud');
  assert.equal(set.url, 'https://soundcloud.com/artist/sets/album-name');
});

test('rejects bad schemes, credentials, ports, and unsupported pages', () => {
  const rejected = [
    'ftp://youtube.com/watch?v=dQw4w9WgXcQ',
    'https://user:pass@www.youtube.com/watch?v=dQw4w9WgXcQ',
    'https://www.youtube.com:8443/watch?v=dQw4w9WgXcQ',
    'https://example.com/watch?v=dQw4w9WgXcQ',
    'https://www.youtube.com.evil.com/watch?v=dQw4w9WgXcQ',
    'https://www.youtube.com/playlist?list=RDabcdefghijk',
    'https://www.youtube.com/playlist?list=WL',
    'https://www.youtube.com/playlist?list=LL',
    'https://www.youtube.com/@someone',
    'https://soundcloud.com/artist',
    'javascript:alert(1)',
    'https://www.youtube.com/watch?v=short',
    'not a url',
    'https://www.youtube.com/watch?\nv=dQw4w9WgXcQ',
  ];
  for (const input of rejected) {
    assert.throws(() => parseMediaUrl(input), undefined, input);
  }
});

test('classifies public and non-public addresses', () => {
  assert.equal(isPublicAddress('8.8.8.8'), true);
  assert.equal(isPublicAddress('142.250.190.78'), true);
  for (const address of ['127.0.0.1', '10.1.1.1', '192.168.1.20', '172.16.5.5', '169.254.169.254', '0.0.0.0', '::1', 'fe80::1', 'fc00::1', '::ffff:127.0.0.1']) {
    assert.equal(isPublicAddress(address), false, address);
  }
});

test('follows a SoundCloud short link and keeps the final track', async () => {
  const seen = [];
  const validation = createValidation({
    lookup: publicLookup,
    request: async (url) => {
      seen.push(url.hostname);
      if (url.hostname === 'on.soundcloud.com') {
        return { status: 302, headers: { location: 'https://soundcloud.com/artist/track-name' } };
      }
      return { status: 200, headers: {} };
    },
  });
  const resolved = await validation.resolve('https://on.soundcloud.com/abc123');
  assert.equal(resolved.url, 'https://soundcloud.com/artist/track-name');
  assert.deepEqual(seen, ['on.soundcloud.com', 'soundcloud.com']);
});

test('rejects a redirect to another site or a private address', async () => {
  const evil = createValidation({
    lookup: publicLookup,
    request: async () => ({ status: 302, headers: { location: 'https://evil.example/track' } }),
  });
  await assert.rejects(
    () => evil.resolve('https://on.soundcloud.com/abc123'),
    (error) => error.code === 'unsupported_url',
  );

  const privateHop = createValidation({
    lookup: async (host) => {
      if (host === 'soundcloud.com') return [{ address: '10.0.0.8', family: 4 }];
      return [{ address: '142.250.190.78', family: 4 }];
    },
    request: async (url) => {
      if (url.hostname === 'on.soundcloud.com') {
        return { status: 302, headers: { location: 'https://soundcloud.com/artist/track-name' } };
      }
      return { status: 200, headers: {} };
    },
  });
  await assert.rejects(() => privateHop.resolve('https://on.soundcloud.com/abc123'), /public address/);
});

test('stops after too many redirects', async () => {
  const validation = createValidation({
    lookup: publicLookup,
    request: async () => ({ status: 302, headers: { location: 'https://on.soundcloud.com/abc123' } }),
  });
  await assert.rejects(() => validation.resolve('https://on.soundcloud.com/abc123'), /redirected too many/);
});
