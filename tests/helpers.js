import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadConfig } from '../src/config.js';
import { createApp } from '../src/server.js';
import { createValidation } from '../src/services/validation.js';

export const silentLog = { debug() {}, info() {}, warn() {}, error() {} };

export function mediaBuffer(kind) {
  if (kind === 'mp3') {
    const buffer = Buffer.alloc(64, 0);
    buffer.write('ID3', 0, 'ascii');
    return buffer;
  }
  const buffer = Buffer.alloc(32, 0);
  buffer.writeUInt32BE(24, 0);
  buffer.write('ftyp', 4, 'ascii');
  buffer.write('isom', 8, 'ascii');
  return buffer;
}

export function workspace(overrides = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'md-'));
  const config = loadConfig({
    HOST: '127.0.0.1',
    PORT: '3000',
    DATA_DIR: path.join(dir, 'data'),
    DOWNLOAD_DIR: path.join(dir, 'downloads'),
    DB_PATH: path.join(dir, 'data', 'app.db'),
    LOG_LEVEL: 'silent',
    CLEANUP_INTERVAL_MINUTES: '0',
    WORKER_SHUTDOWN_SECONDS: '2',
    RATE_LIMIT_PER_MINUTE: '600',
    ...overrides,
  }, dir);
  return {
    dir,
    config,
    remove() {
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

export const publicLookup = async () => [{ address: '142.250.190.78', family: 4 }];

export function validationWith(request = async () => ({ status: 200, headers: {} }), lookup = publicLookup) {
  return createValidation({ lookup, request });
}

export function mockMedia(impl = {}) {
  return {
    async inspect() {
      return {
        kind: 'video',
        title: 'Fixture',
        uploader: 'Artist',
        durationSeconds: 12,
        thumbnailUrl: null,
        bytes: 1000,
        videoId: 'dQw4w9WgXcQ',
        truncated: false,
        entries: [],
      };
    },
    async stream({ onFirstByte, workDir }) {
      if (workDir) fs.mkdirSync(workDir, { recursive: true });
      const buf = mediaBuffer('m4a');
      onFirstByte?.(buf);
      return { bytes: buf.length, ext: 'm4a' };
    },
    async zip({ onFirstByte, workDir }) {
      if (workDir) fs.mkdirSync(workDir, { recursive: true });
      const buf = Buffer.from('PK\x03\x04fixture');
      onFirstByte?.(buf);
      return { bytes: buf.length, ext: 'zip' };
    },
    async probe() {
      return { ytdlp: true, ffmpeg: true };
    },
    ...impl,
  };
}

export async function testApp(overrides = {}, options = {}) {
  const space = workspace(overrides);
  const ctx = await createApp({
    config: space.config,
    validation: options.validation || validationWith(options.request, options.lookup),
    media: options.media === undefined ? mockMedia() : options.media,
    tools: options.tools || { ytdlp: true, ffmpeg: true },
    now: options.now,
    log: silentLog,
  });
  return { ...ctx, space };
}

export function call(app, method, url, { body, headers = {} } = {}) {
  return app.inject({
    method,
    url,
    headers: {
      'x-media-request': '1',
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...headers,
    },
    payload: body,
  });
}

export async function waitFor(check, timeoutMs = 2000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('timed out waiting for condition');
}
