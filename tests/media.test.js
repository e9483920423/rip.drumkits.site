import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { loadConfig } from '../src/config.js';
import {
  buildFileArgs,
  buildStreamArgs,
  buildInfoArgs,
  classifyProcessFailure,
  createMediaService,
  formatsFor,
  isSuccessfulStreamResult,
  parseInfoPayload,
  parseProgressLine,
} from '../src/services/media.js';

const config = loadConfig({ LOG_LEVEL: 'silent', MAX_DURATION_SECONDS: '30', MAX_FILE_SIZE_MB: '1' }, process.cwd());
const url = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';

test('metadata and download arguments stay on a fixed allowlist', () => {
  const info = buildInfoArgs(url);
  assert.equal(info.at(-1), url);
  assert.ok(info.includes('--dump-single-json'));
  assert.ok(info.includes('--no-download'));
  assert.ok(info.includes('--no-playlist'));
  assert.equal(info.some((arg) => /cookie|proxy|extractor-args|xattr/i.test(arg)), false);

  const download = buildStreamArgs(config, {
    url,
    formatId: 'mp3',
    source: 'youtube',
  });
  assert.equal(download.args.at(-1), url);
  assert.equal(download.args[download.args.indexOf('-o') + 1], '-');
  assert.ok(download.args.includes('--audio-format'));
  assert.ok(download.args.includes('--no-playlist'));
  assert.equal(download.args.includes('--max-downloads'), false);
  assert.equal(download.args.some((arg) => /cookie|proxy|extractor-args/.test(arg)), false);
  assert.throws(() => buildStreamArgs(config, {
    url,
    formatId: 'best;touch /tmp/x',
    source: 'youtube',
  }), /format/);
  assert.throws(() => buildStreamArgs(config, {
    url,
    formatId: 'mp4',
    source: 'soundcloud',
  }), /format/);

  const youtubeIds = formatsFor('youtube').map((item) => item.id);
  const soundcloudIds = formatsFor('soundcloud').map((item) => item.id);
  assert.deepEqual(youtubeIds, ['audio', 'mp3', 'opus', 'flac', 'mp4', 'mp4-720']);
  assert.deepEqual(soundcloudIds, ['audio', 'mp3', 'opus', 'flac']);
  const opus = buildStreamArgs(config, { url, formatId: 'opus', source: 'youtube' });
  assert.equal(opus.args[opus.args.indexOf('--audio-format') + 1], 'opus');
  const flac = buildStreamArgs(config, { url, formatId: 'flac', source: 'soundcloud' });
  assert.equal(flac.args[flac.args.indexOf('--audio-format') + 1], 'flac');

  const playlist = buildInfoArgs('https://www.youtube.com/playlist?list=PLfakelist1234567890123456789012', {
    playlist: true,
    limit: 100,
  });
  assert.ok(playlist.includes('--flat-playlist'));
  assert.ok(playlist.includes('--yes-playlist'));
  assert.equal(playlist.includes('--no-playlist'), false);
  assert.equal(playlist[playlist.indexOf('--playlist-end') + 1], '100');
  const soundcloudSet = buildInfoArgs('https://soundcloud.com/artist/sets/album', {
    playlist: true,
    flat: false,
    limit: 100,
  });
  assert.ok(soundcloudSet.includes('--yes-playlist'));
  assert.equal(soundcloudSet.includes('--flat-playlist'), false);
  const fileOut = buildFileArgs(config, {
    url,
    formatId: 'audio',
    source: 'youtube',
    output: '01.%(ext)s',
  });
  assert.equal(fileOut.args[fileOut.args.indexOf('-o') + 1], '01.%(ext)s');
});

test('parses metadata, progress, and process failures', () => {
  const info = parseInfoPayload(JSON.stringify({
    id: 'dQw4w9WgXcQ',
    title: 'Hello\u0000 World',
    uploader: 'Artist',
    duration: 12,
    extractor_key: 'Youtube',
    thumbnail: 'https://evil.example/a.jpg',
  }), 'youtube', config);
  assert.equal(info.title, 'Hello World');
  assert.equal(info.thumbnailUrl, 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg');

  const art = parseInfoPayload(JSON.stringify({
    id: '1',
    title: 'Track',
    extractor_key: 'Soundcloud',
    thumbnail: 'https://i1.sndcdn.com/artworks-test.jpg',
    duration: 4,
  }), 'soundcloud', config);
  assert.match(art.thumbnailUrl, /^https:\/\/i1\.sndcdn\.com\//);

  assert.throws(() => parseInfoPayload(JSON.stringify({
    _type: 'playlist',
    entries: [],
    extractor_key: 'Youtube',
  }), 'youtube', config), /Playlist/);
  assert.throws(() => parseInfoPayload(JSON.stringify({
    title: 'Long',
    duration: 999,
    extractor_key: 'Youtube',
    id: 'dQw4w9WgXcQ',
  }), 'youtube', config), /longer/);

  assert.deepEqual(parseProgressLine('MDPROG 250|1000|1000|downloading'), { percent: 25 });
  assert.equal(parseProgressLine('not progress'), null);
  assert.equal(classifyProcessFailure({ timedOut: true }).code, 'timeout');
  assert.equal(classifyProcessFailure({ code: 1, stderr: 'ERROR: Video unavailable' }).code, 'unavailable');
  assert.equal(classifyProcessFailure({ code: 1, stderr: 'Private video' }).code, 'restricted');
  assert.equal(classifyProcessFailure({ code: 'ENOENT' }).message.includes('yt-dlp'), true);
  assert.equal(classifyProcessFailure({ code: 1, stderr: 'secret /var/lib/app' }).message.includes('/var'), false);
  assert.equal(isSuccessfulStreamResult({ code: 0, started: true }), true);
  assert.equal(isSuccessfulStreamResult({
    code: 101,
    started: true,
    stderr: '[download] Download completed\nMaximum number of downloads reached',
  }), true);
  assert.equal(isSuccessfulStreamResult({ code: 101, started: false, stderr: 'Download completed' }), false);
  assert.equal(isSuccessfulStreamResult({ code: 1, started: true, stderr: 'ERROR: boom' }), false);

  const playlist = parseInfoPayload(JSON.stringify({
    _type: 'playlist',
    id: 'PLfakelist1234567890123456789012',
    title: 'Album',
    uploader: 'DJ',
    extractor_key: 'YoutubeTab',
    playlist_count: 250,
    entries: [
      { id: 'dQw4w9WgXcQ', title: 'One', duration: 12 },
      { id: 'jNQXAC9IVRw', title: 'Two', duration: 8 },
      { id: 'liveitem12x', title: 'Live', duration: 20, is_live: true },
      { id: 'toolong1234', title: 'Long', duration: 999 },
    ],
  }), 'youtube', config, { kind: 'playlist' });
  assert.equal(playlist.kind, 'playlist');
  assert.equal(playlist.truncated, true);
  assert.equal(playlist.entries.length, 2);
  assert.equal(playlist.entries[0].url, url);
  assert.equal(playlist.thumbnailUrl, 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg');

  const soundcloud = parseInfoPayload(JSON.stringify({
    _type: 'playlist',
    id: 'set1',
    title: 'Kiss or Kill',
    uploader: 'swords2',
    extractor_key: 'SoundcloudSet',
    playlist_count: 20,
    entries: [
      {
        id: '1',
        title: null,
        duration: 12000,
        webpage_url: 'https://soundcloud.com/swords2/hammer-tyme',
      },
      {
        id: '2',
        duration: 8000,
        url: 'https://soundcloud.com/swords2/weird-life',
      },
      {
        id: '3',
        title: 'kiss or kill',
        duration: 12,
        url: 'https://api.soundcloud.com/tracks/3',
        webpage_url: 'https://soundcloud.com/swords2/kiss-or-kill',
      },
    ],
  }), 'soundcloud', config, { kind: 'playlist' });
  assert.equal(soundcloud.entries.length, 3);
  assert.equal(soundcloud.entries[0].title, 'hammer tyme');
  assert.equal(soundcloud.entries[0].durationSeconds, 12);
  assert.equal(soundcloud.entries[1].title, 'weird life');
  assert.equal(soundcloud.entries[1].durationSeconds, 8);
  assert.equal(soundcloud.entries[2].title, 'kiss or kill');
  assert.equal(soundcloud.entries[2].url, 'https://soundcloud.com/swords2/kiss-or-kill');
});

test('keeps a finished yt-dlp stream when the process exits 101', async () => {
  const service = createMediaService(config, {
    streamProcess: async () => ({
      code: 101,
      started: true,
      bytes: 2048,
      stderr: '[download] Destination: -\n[download] Download completed\n[info] Maximum number of downloads reached, stopping due to --max-downloads\nAborting remaining downloads\n',
    }),
  });
  const result = await service.stream({
    url,
    source: 'youtube',
    format: 'mp4',
    workDir: '.',
    onFirstByte() {},
    write() {},
  });
  assert.equal(result.bytes, 2048);
  assert.equal(result.ext, 'mp4');
});

test('zips two finished files and keeps a valid archive', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'md-zip-'));
  const service = createMediaService(config, {
    runProcess: async (_command, args, options) => {
      const output = args[args.indexOf('-o') + 1];
      const dest = path.join(options.cwd, String(output).replace('%(ext)s', 'm4a'));
      const buf = Buffer.alloc(32, 0);
      buf.writeUInt32BE(24, 0);
      buf.write('ftyp', 4, 'ascii');
      buf.write('isom', 8, 'ascii');
      fs.writeFileSync(dest, buf);
      return { code: 0, stdout: '', stderr: '' };
    },
  });
  try {
    const chunks = [];
    const result = await service.zip({
      items: [
        { url, title: 'One' },
        { url, title: 'Two' },
      ],
      source: 'youtube',
      format: 'audio',
      workDir: dir,
      onFirstByte(chunk) { chunks.push(chunk); },
      write(chunk) { chunks.push(chunk); },
    });
    assert.equal(result.ext, 'zip');
    const zip = Buffer.concat(chunks);
    assert.equal(zip.subarray(0, 2).toString('ascii'), 'PK');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
