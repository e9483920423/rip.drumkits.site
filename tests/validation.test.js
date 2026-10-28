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

test('accepts Spotify tracks, albums, and playlists and canonicalizes them', () => {
  const track = 'https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT';
  assert.equal(parseMediaUrl(track).url, track);
  assert.equal(parseMediaUrl(track).kind, 'video');
  assert.equal(parseMediaUrl(track).source, 'spotify');
  assert.equal(
    parseMediaUrl('https://open.spotify.com/intl-en/track/4cOdK2wGLETKBW3PvgPWqT?si=abc').url,
    track,
  );
  assert.equal(
    parseMediaUrl('https://open.spotify.com/embed/track/4cOdK2wGLETKBW3PvgPWqT').url,
    track,
  );
  const album = parseMediaUrl('https://play.spotify.com/album/4yP0hdKOZPNshxUOjY0cZj');
  assert.equal(album.kind, 'playlist');
  assert.equal(album.source, 'spotify');
  assert.equal(album.url, 'https://open.spotify.com/album/4yP0hdKOZPNshxUOjY0cZj');
  const playlist = parseMediaUrl('https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M');
  assert.equal(playlist.kind, 'playlist');
  assert.equal(playlist.url, 'https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M');
  assert.equal(parseMediaUrl('https://spotify.link/abc123').short, true);
});

test('accepts allowlisted yt-dlp sites', () => {
  const vimeo = parseMediaUrl('https://vimeo.com/148751763');
  assert.equal(vimeo.source, 'vimeo');
  assert.equal(vimeo.kind, 'video');
  assert.equal(vimeo.url, 'https://vimeo.com/148751763');
  assert.equal(parseMediaUrl('https://player.vimeo.com/video/148751763').url, 'https://vimeo.com/148751763');
  assert.equal(parseMediaUrl('https://vimeo.com/showcase/12345').kind, 'playlist');

  const vod = parseMediaUrl('https://www.twitch.tv/videos/123456789');
  assert.equal(vod.source, 'twitch');
  assert.equal(parseMediaUrl('https://clips.twitch.tv/ClipNameHere').source, 'twitch');
  assert.throws(() => parseMediaUrl('https://www.twitch.tv/somechannel'));

  const bili = parseMediaUrl('https://www.bilibili.com/video/BV1xx411c7mD');
  assert.equal(bili.source, 'bilibili');
  assert.equal(parseMediaUrl('https://b23.tv/abc12').short, true);

  const reddit = parseMediaUrl('https://www.reddit.com/r/videos/comments/abc123/title-here');
  assert.equal(reddit.source, 'reddit');
  assert.equal(parseMediaUrl('https://v.redd.it/abcd1234').short, true);

  const tweet = parseMediaUrl('https://twitter.com/user/status/1234567890123456789');
  assert.equal(tweet.source, 'x');
  assert.equal(tweet.url, 'https://x.com/i/status/1234567890123456789');

  assert.equal(parseMediaUrl('https://www.facebook.com/watch/?v=1234567890').source, 'facebook');
  assert.equal(parseMediaUrl('https://fb.watch/abcDE').short, true);
  assert.equal(parseMediaUrl('https://www.flickr.com/photos/someone/123456789').source, 'flickr');
  assert.equal(parseMediaUrl('https://framatube.org/w/abcDEF').source, 'peertube');
  assert.equal(parseMediaUrl('https://www.dailymotion.com/video/x7xyzab').source, 'dailymotion');
  assert.equal(parseMediaUrl('https://www.ted.com/talks/someone_a_talk').source, 'ted');
  assert.equal(parseMediaUrl('https://www.ted.com/playlists/12/best_talks').kind, 'playlist');

  const album = parseMediaUrl('https://velocitygirl.bandcamp.com/album/copacetic');
  assert.equal(album.source, 'bandcamp');
  assert.equal(album.kind, 'playlist');
  assert.equal(album.url, 'https://velocitygirl.bandcamp.com/album/copacetic');
  const track = parseMediaUrl('https://velocitygirl.bandcamp.com/track/pretty-sister');
  assert.equal(track.source, 'bandcamp');
  assert.equal(track.kind, 'video');
  assert.equal(track.url, 'https://velocitygirl.bandcamp.com/track/pretty-sister');
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
    'https://velocitygirl.bandcamp.com/',
    'https://velocitygirl.bandcamp.com/music',
    'https://bandcamp.com/',
    'https://daily.bandcamp.com/album/copacetic',
    'https://open.spotify.com/artist/1dfeR4HaWDbWqFHLkxsg1d',
    'https://open.spotify.com/episode/4cOdK2wGLETKBW3PvgPWqT',
    'https://open.spotify.com/show/4cOdK2wGLETKBW3PvgPWqT',
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

test('follows a Spotify short link and keeps the final track', async () => {
  const validation = createValidation({
    lookup: publicLookup,
    request: async (url) => {
      if (url.hostname === 'spotify.link') {
        return { status: 302, headers: { location: 'https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT' } };
      }
      return { status: 200, headers: {} };
    },
  });
  const resolved = await validation.resolve('https://spotify.link/abc123');
  assert.equal(resolved.url, 'https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT');
  assert.equal(resolved.source, 'spotify');
});

test('stops after too many redirects', async () => {
  const validation = createValidation({
    lookup: publicLookup,
    request: async () => ({ status: 302, headers: { location: 'https://on.soundcloud.com/abc123' } }),
  });
  await assert.rejects(() => validation.resolve('https://on.soundcloud.com/abc123'), /redirected too many/);
});
