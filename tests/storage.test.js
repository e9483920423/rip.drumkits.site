import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
  assertJobId,
  contentDisposition,
  createStorage,
  sanitizeFilename,
  verifyMediaFile,
} from '../src/services/storage.js';
import { mediaBuffer, workspace } from './helpers.js';

test('sanitizes display names and download headers', () => {
  assert.equal(sanitizeFilename('../../etc/passwd').includes('/'), false);
  assert.equal(sanitizeFilename('../../etc/passwd').includes('\\'), false);
  const header = contentDisposition('Hello\r\nSet-Cookie: evil.mp3');
  assert.equal(header.includes('\n'), false);
  assert.equal(header.includes('\r'), false);
  assert.match(header, /^attachment;/);
});

test('verifies media files and rejects unsafe ids', () => {
  const space = workspace();
  const storage = createStorage(space.config);
  storage.ensureDirs();
  const good = path.join(space.config.tmpDir, 'clip.m4a');
  fs.writeFileSync(good, mediaBuffer('m4a'));
  assert.equal(verifyMediaFile(good, 1024 * 1024).ext, 'm4a');
  const opus = path.join(space.config.tmpDir, 'clip.opus');
  const opusBuf = Buffer.alloc(32, 0);
  opusBuf.write('OggS', 0, 'ascii');
  fs.writeFileSync(opus, opusBuf);
  assert.equal(verifyMediaFile(opus, 1024 * 1024).ext, 'opus');
  const flac = path.join(space.config.tmpDir, 'clip.flac');
  const flacBuf = Buffer.alloc(32, 0);
  flacBuf.write('fLaC', 0, 'ascii');
  fs.writeFileSync(flac, flacBuf);
  assert.equal(verifyMediaFile(flac, 1024 * 1024).ext, 'flac');

  const empty = path.join(space.dir, 'empty.mp4');
  fs.writeFileSync(empty, Buffer.alloc(0));
  assert.throws(() => verifyMediaFile(empty, 1000), /valid file/);
  fs.writeFileSync(empty, Buffer.from('not media at all'));
  assert.throws(() => verifyMediaFile(empty, 1000), /valid media/);
  assert.throws(() => assertJobId('../secret.txt'), /invalid/i);
  assert.throws(() => assertJobId('..\\secret.txt'), /invalid/i);
  space.remove();
});

test('cleanup removes stale temp directories and leaves active work alone', () => {
  const space = workspace({ TEMP_RETENTION_HOURS: '6' });
  const storage = createStorage(space.config);
  storage.ensureDirs();
  const old = Date.now() - (48 * 60 * 60 * 1000);

  const activeId = '22222222-2222-4222-8222-222222222222';
  const activeDir = storage.createWorkDir(activeId);
  fs.writeFileSync(path.join(activeDir, 'partial.bin'), 'partial');
  fs.utimesSync(activeDir, new Date(old), new Date(old));

  const staleId = '33333333-3333-4333-8333-333333333333';
  const staleDir = storage.createWorkDir(staleId);
  fs.utimesSync(staleDir, new Date(old), new Date(old));

  storage.cleanupTemps([activeId], Date.now());
  assert.equal(fs.existsSync(activeDir), true);
  assert.equal(fs.existsSync(staleDir), false);
  space.remove();
});

test('refuses work when free temp disk is below the floor', () => {
  const space = workspace({ MIN_FREE_DISK_MB: '512' });
  const storage = createStorage(space.config, { freeBytes: () => 1024 });
  storage.ensureDirs();
  assert.throws(() => storage.assertFreeDisk(), /disk space/);
  const skipped = createStorage(space.config, {
    freeBytes: () => {
      throw new Error('statfs unavailable');
    },
  });
  assert.doesNotThrow(() => skipped.assertFreeDisk());
  const plenty = createStorage(space.config, { freeBytes: () => 2 * 1024 * 1024 * 1024 });
  assert.doesNotThrow(() => plenty.assertFreeDisk());
  space.remove();
});
