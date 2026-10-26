import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { AppError } from '../src/errors.js';
import { createApp } from '../src/server.js';
import { call, mockMedia, testApp, workspace, validationWith, silentLog } from './helpers.js';

const VIDEO = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';

test('validates requests, streams a file, and hides internals', async () => {
  const ctx = await testApp();
  try {
    const page = await ctx.app.inject({ method: 'GET', url: '/' });
    assert.equal(page.statusCode, 200);
    assert.match(page.body, /rip\.drumkits\.site/);
    assert.match(page.body, /src="\/app.js"/);
    assert.doesNotMatch(page.body, /unpkg|googleapis|cdnjs/);
    assert.match(page.headers['content-security-policy'], /default-src 'self'/);
    assert.equal(page.headers['x-frame-options'], 'DENY');

    const missing = await call(ctx.app, 'POST', '/api/media/info', { body: {} });
    assert.equal(missing.statusCode, 400);
    const badHost = await call(ctx.app, 'POST', '/api/media/info', { body: { url: 'https://example.com/watch?v=dQw4w9WgXcQ' } });
    assert.equal(badHost.statusCode, 400);
    const info = await call(ctx.app, 'POST', '/api/media/info', { body: { url: VIDEO } });
    assert.equal(info.statusCode, 200);
    assert.equal(info.json().title, 'Fixture');
    assert.ok(info.json().formats.some((format) => format.id === 'mp4'));
    assert.ok(info.json().formats.some((format) => format.id === 'opus'));
    assert.ok(info.json().formats.some((format) => format.id === 'flac'));

    const badFormat = await call(ctx.app, 'POST', '/api/media/download', { body: { url: VIDEO, format: 'best;rm' } });
    assert.equal(badFormat.statusCode, 400);
    const noHeader = await ctx.app.inject({
      method: 'POST',
      url: '/api/media/download',
      headers: { 'content-type': 'application/json' },
      payload: { url: VIDEO, format: 'audio' },
    });
    assert.equal(noHeader.statusCode, 403);

    const created = await call(ctx.app, 'POST', '/api/media/download', {
      body: { url: VIDEO, format: 'audio', title: 'Hello\r\nSet-Cookie: evil' },
    });
    assert.equal(created.statusCode, 200);
    const ticket = created.json().ticket;
    assert.match(ticket, /^[0-9a-f-]{36}$/i);
    assert.equal(JSON.stringify(created.json()).includes(ctx.config.tmpDir), false);

    const file = await call(ctx.app, 'GET', `/api/media/download/${ticket}`);
    assert.equal(file.statusCode, 200);
    assert.match(file.headers['content-disposition'], /attachment;/);
    assert.equal(file.headers['content-disposition'].includes('\n'), false);
    assert.equal(file.headers['content-type'], 'application/octet-stream');
    assert.equal(file.rawPayload.subarray(4, 8).toString('ascii'), 'ftyp');
    assert.equal(fs.existsSync(path.join(ctx.config.tmpDir, ticket)), false);
    const leftover = fs.existsSync(ctx.config.downloadDir)
      ? fs.readdirSync(ctx.config.downloadDir)
      : [];
    assert.deepEqual(leftover, []);

    const reused = await call(ctx.app, 'GET', `/api/media/download/${ticket}`);
    assert.equal(reused.statusCode, 404);

    const traversed = await call(ctx.app, 'GET', '/api/media/download/../secret.txt');
    assert.ok(traversed.statusCode === 400 || traversed.statusCode === 404);
    assert.equal(String(traversed.body).includes('top-secret'), false);

    const broken = await testApp({}, {
      media: mockMedia({
        async inspect() {
          throw new Error('secret /etc/passwd');
        },
      }),
    });
    try {
      const hidden = await call(broken.app, 'POST', '/api/media/info', { body: { url: VIDEO } });
      assert.equal(hidden.statusCode, 500);
      assert.equal(hidden.body.includes('/etc/passwd'), false);
      assert.equal(hidden.body.includes('stack'), false);
      assert.match(hidden.json().error.message, /Something went wrong/);
    } finally {
      await broken.close();
      broken.space.remove();
    }
  } finally {
    await ctx.close();
    ctx.space.remove();
  }
});

test('rejects cross-site state changes without the media request header', async () => {
  const ctx = await testApp({ RATE_LIMIT_PER_MINUTE: '600' });
  try {
    const health = await ctx.app.inject({ method: 'GET', url: '/api/health' });
    assert.equal(health.statusCode, 200);
    assert.equal(health.json().ok, true);

    const crossSite = await ctx.app.inject({
      method: 'POST',
      url: '/api/media/download',
      headers: { 'content-type': 'application/json' },
      payload: { url: VIDEO, format: 'audio' },
    });
    assert.equal(crossSite.statusCode, 403);

    const created = await call(ctx.app, 'POST', '/api/media/download', {
      body: { url: VIDEO, format: 'audio' },
    });
    assert.equal(created.statusCode, 200);
  } finally {
    await ctx.close();
    ctx.space.remove();
  }
});

test('rate limit and oversized bodies return sanitized errors', async () => {
  let clock = 1_000_000;
  const limited = await testApp({ RATE_LIMIT_PER_MINUTE: '2' }, { now: () => clock });
  try {
    assert.equal((await limited.app.inject({ method: 'GET', url: '/api/health' })).statusCode, 200);
    assert.equal((await limited.app.inject({ method: 'GET', url: '/api/health' })).statusCode, 200);
    const blocked = await limited.app.inject({ method: 'GET', url: '/api/health' });
    assert.equal(blocked.statusCode, 429);
    assert.equal(blocked.headers['retry-after'], '60');
  } finally {
    await limited.close();
    limited.space.remove();
  }

  const small = await testApp({ BODY_LIMIT_BYTES: '1024' });
  try {
    const oversized = await call(small.app, 'POST', '/api/media/info', {
      body: { url: `https://www.youtube.com/watch?v=dQw4w9WgXcQ&x=${'a'.repeat(2000)}` },
    });
    assert.equal(oversized.statusCode, 413);
    assert.match(oversized.json().error.message, /too large/i);
  } finally {
    await small.close();
    small.space.remove();
  }
});

test('starts when yt-dlp and FFmpeg are missing', async () => {
  const space = workspace({ YTDLP_PATH: 'md-missing-ytdlp', FFMPEG_PATH: 'md-missing-ffmpeg' });
  const ctx = await createApp({
    config: space.config,
    validation: validationWith(),
    log: silentLog,
  });
  try {
    const health = await ctx.app.inject({ method: 'GET', url: '/api/health' });
    assert.equal(health.statusCode, 200);
    assert.equal(health.json().ok, true);
    assert.equal(health.json().tools.ytdlp, false);
    assert.equal(health.json().tools.ffmpeg, false);
    const info = await call(ctx.app, 'POST', '/api/media/info', { body: { url: VIDEO } });
    assert.equal(info.statusCode, 503);
    assert.match(info.json().error.message, /yt-dlp/);
    const download = await call(ctx.app, 'POST', '/api/media/download', { body: { url: VIDEO, format: 'audio' } });
    assert.equal(download.statusCode, 503);
  } finally {
    await ctx.close();
    space.remove();
  }
});

test('limits concurrent streams and cleans temp files after failure', async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  let started = 0;
  const ctx = await testApp({ MAX_CONCURRENT_JOBS: '1' }, {
    media: mockMedia({
      async stream({ workDir, onFirstByte, signal }) {
        started += 1;
        fs.mkdirSync(workDir, { recursive: true });
        fs.writeFileSync(path.join(workDir, 'partial.bin'), 'partial');
        onFirstByte(Buffer.from('ftypxxxx'));
        await new Promise((resolve, reject) => {
          if (signal?.aborted) {
            reject(new AppError('cancelled', 'The download was cancelled.', 409));
            return;
          }
          signal?.addEventListener('abort', () => {
            reject(new AppError('cancelled', 'The download was cancelled.', 409));
          }, { once: true });
          gate.then(resolve, reject);
        });
      },
    }),
  });
  try {
    const first = await call(ctx.app, 'POST', '/api/media/download', { body: { url: VIDEO, format: 'audio' } });
    const pending = call(ctx.app, 'GET', `/api/media/download/${first.json().ticket}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
    await waitUntil(() => started === 1);
    const blocked = await call(ctx.app, 'POST', '/api/media/download', { body: { url: VIDEO, format: 'audio' } });
    assert.equal(blocked.statusCode, 429);
    release();
    await pending;
    assert.equal(fs.existsSync(path.join(ctx.config.tmpDir, first.json().ticket)), false);
  } finally {
    release();
    await ctx.close();
    ctx.space.remove();
  }
});

test('inspects a playlist, downloads one track, and zips two tracks', async () => {
  const playlist = 'https://www.youtube.com/playlist?list=PLfakelist1234567890123456789012';
  const second = 'https://www.youtube.com/watch?v=jNQXAC9IVRw';
  const ctx = await testApp({}, {
    media: mockMedia({
      async inspect() {
        return {
          kind: 'playlist',
          title: 'Mix',
          uploader: 'DJ',
          durationSeconds: null,
          thumbnailUrl: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
          truncated: false,
          entries: [
            { id: 'dQw4w9WgXcQ', title: 'One', durationSeconds: 12, url: VIDEO },
            { id: 'jNQXAC9IVRw', title: 'Two', durationSeconds: 8, url: second },
          ],
        };
      },
    }),
  });
  try {
    const info = await call(ctx.app, 'POST', '/api/media/info', { body: { url: playlist } });
    assert.equal(info.statusCode, 200);
    assert.equal(info.json().kind, 'playlist');
    assert.equal(info.json().entries.length, 2);
    assert.equal(info.json().maxZipItems, 20);

    const missing = await call(ctx.app, 'POST', '/api/media/download', {
      body: { url: playlist, format: 'audio', title: 'Mix' },
    });
    assert.equal(missing.statusCode, 400);

    const one = await call(ctx.app, 'POST', '/api/media/download', {
      body: { url: playlist, format: 'audio', title: 'Mix', items: [{ url: VIDEO, title: 'One' }] },
    });
    assert.equal(one.statusCode, 200);
    const file = await call(ctx.app, 'GET', `/api/media/download/${one.json().ticket}`);
    assert.equal(file.statusCode, 200);
    assert.equal(file.headers['content-type'], 'application/octet-stream');
    assert.match(file.headers['content-disposition'], /One\.m4a/);
    assert.equal(file.rawPayload.subarray(4, 8).toString('ascii'), 'ftyp');

    const two = await call(ctx.app, 'POST', '/api/media/download', {
      body: {
        url: playlist,
        format: 'audio',
        title: 'Mix',
        items: [
          { url: VIDEO, title: 'One' },
          { url: second, title: 'Two' },
        ],
      },
    });
    assert.equal(two.statusCode, 200);
    const zip = await call(ctx.app, 'GET', `/api/media/download/${two.json().ticket}`);
    assert.equal(zip.statusCode, 200);
    assert.match(zip.headers['content-disposition'], /\.zip/);
    assert.equal(zip.rawPayload.subarray(0, 2).toString('ascii'), 'PK');
    assert.equal(fs.existsSync(path.join(ctx.config.tmpDir, two.json().ticket)), false);
  } finally {
    await ctx.close();
    ctx.space.remove();
  }
});

async function waitUntil(check) {
  const start = Date.now();
  while (Date.now() - start < 2000) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('timed out');
}
