import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/server.js';
import { call, silentLog, validationWith, workspace } from './helpers.js';

const fake = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'fake-ytdlp.js');
const fakeSpotdl = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'fake-spotdl.js');
const VIDEO = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';

test('streams a local fixture through the real process runner', { timeout: 20000 }, async () => {
  const space = workspace({
    YTDLP_PATH: fake,
    FFMPEG_PATH: fake,
    JOB_TIMEOUT_SECONDS: '30',
  });
  const ctx = await createApp({
    config: space.config,
    validation: validationWith(),
    tools: { ytdlp: true, ffmpeg: true, spotdl: true },
    log: silentLog,
  });
  try {
    const info = await call(ctx.app, 'POST', '/api/media/info', { body: { url: VIDEO } });
    assert.equal(info.statusCode, 200);
    assert.equal(info.json().title, 'Fixture Track');
    assert.equal(info.json().thumbnailUrl, 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg');

    const created = await call(ctx.app, 'POST', '/api/media/download', {
      body: { url: info.json().url, format: 'audio', title: info.json().title },
    });
    assert.equal(created.statusCode, 200);
    const ticket = created.json().ticket;
    const file = await call(ctx.app, 'GET', `/api/media/download/${ticket}`);
    assert.equal(file.statusCode, 200, file.body?.slice?.(0, 200) || file.body);
    assert.equal(file.rawPayload.subarray(4, 8).toString('ascii'), 'ftyp');
    assert.equal(fs.existsSync(path.join(ctx.config.tmpDir, ticket)), false);
    assert.equal(fs.existsSync(ctx.config.downloadDir) ? fs.readdirSync(ctx.config.downloadDir).length : 0, 0);

    const missing = await call(ctx.app, 'POST', '/api/media/download', {
      body: { url: 'https://www.youtube.com/watch?v=UNAVAILABCD', format: 'audio' },
    });
    const failed = await call(ctx.app, 'GET', `/api/media/download/${missing.json().ticket}`);
    assert.equal(failed.statusCode, 422);
    assert.equal(failed.json().error.code, 'unavailable');
  } finally {
    await ctx.close();
    space.remove();
  }
});

test('inspects a fixture playlist and zips two selected tracks', { timeout: 20000 }, async () => {
  const playlist = 'https://www.youtube.com/playlist?list=PLfakelist1234567890123456789012';
  const space = workspace({
    YTDLP_PATH: fake,
    FFMPEG_PATH: fake,
    JOB_TIMEOUT_SECONDS: '30',
  });
  const ctx = await createApp({
    config: space.config,
    validation: validationWith(),
    tools: { ytdlp: true, ffmpeg: true, spotdl: true },
    log: silentLog,
  });
  try {
    const info = await call(ctx.app, 'POST', '/api/media/info', { body: { url: playlist } });
    assert.equal(info.statusCode, 200, info.body);
    assert.equal(info.json().kind, 'playlist');
    assert.equal(info.json().title, 'Fixture Playlist');
    assert.equal(info.json().entries.length, 2);

    const created = await call(ctx.app, 'POST', '/api/media/download', {
      body: {
        url: info.json().url,
        format: 'audio',
        title: info.json().title,
        items: info.json().entries.map((entry) => ({ url: entry.url, title: entry.title })),
      },
    });
    assert.equal(created.statusCode, 200);
    const zip = await call(ctx.app, 'GET', `/api/media/download/${created.json().ticket}`);
    assert.equal(zip.statusCode, 200, zip.body?.slice?.(0, 200) || zip.body);
    assert.equal(zip.rawPayload.subarray(0, 2).toString('ascii'), 'PK');
    assert.equal(fs.existsSync(path.join(ctx.config.tmpDir, created.json().ticket)), false);
  } finally {
    await ctx.close();
    space.remove();
  }
});

test('inspects a Spotify album fixture and streams a selected track', { timeout: 20000 }, async () => {
  const album = 'https://open.spotify.com/album/4yP0hdKOZPNshxUOjY0cZj';
  const space = workspace({
    YTDLP_PATH: fake,
    FFMPEG_PATH: fake,
    SPOTDL_PATH: fakeSpotdl,
    JOB_TIMEOUT_SECONDS: '30',
  });
  const ctx = await createApp({
    config: space.config,
    validation: validationWith(),
    tools: { ytdlp: true, ffmpeg: true, spotdl: true },
    log: silentLog,
  });
  try {
    const info = await call(ctx.app, 'POST', '/api/media/info', { body: { url: album } });
    assert.equal(info.statusCode, 200, info.body);
    assert.equal(info.json().kind, 'playlist');
    assert.equal(info.json().source, 'spotify');
    assert.equal(info.json().title, 'Fixture Playlist');
    assert.equal(info.json().entries.length, 2);
    assert.equal(info.json().thumbnailUrl, 'https://i.scdn.co/image/ab67616d0000b273fixture');
    assert.equal(info.json().formats.some((format) => format.id === 'mp4'), false);

    const created = await call(ctx.app, 'POST', '/api/media/download', {
      body: {
        url: info.json().url,
        format: 'audio',
        title: info.json().title,
        items: [{ url: info.json().entries[0].url, title: info.json().entries[0].title }],
      },
    });
    assert.equal(created.statusCode, 200);
    const file = await call(ctx.app, 'GET', `/api/media/download/${created.json().ticket}`);
    assert.equal(file.statusCode, 200, file.body?.slice?.(0, 200) || file.body);
    assert.equal(file.rawPayload.subarray(4, 8).toString('ascii'), 'ftyp');
    assert.equal(fs.existsSync(path.join(ctx.config.tmpDir, created.json().ticket)), false);

    const zipCreated = await call(ctx.app, 'POST', '/api/media/download', {
      body: {
        url: info.json().url,
        format: 'audio',
        title: info.json().title,
        items: info.json().entries.map((entry) => ({ url: entry.url, title: entry.title })),
      },
    });
    assert.equal(zipCreated.statusCode, 200);
    const zip = await call(ctx.app, 'GET', `/api/media/download/${zipCreated.json().ticket}`);
    assert.equal(zip.statusCode, 200, zip.body?.slice?.(0, 200) || zip.body);
    assert.equal(zip.rawPayload.subarray(0, 2).toString('ascii'), 'PK');
  } finally {
    await ctx.close();
    space.remove();
  }
});
