import assert from 'node:assert/strict';
import test from 'node:test';
import { AppError } from '../src/errors.js';
import { buildConvertArgs, getConvertFormat, inputExtension } from '../src/services/convert.js';

test('convert arguments stay on a fixed allowlist', () => {
  const args = buildConvertArgs('/tmp/in.wav', '/tmp/out.mp3', 'mp3');
  assert.deepEqual(args.slice(0, 5), ['-y', '-hide_banner', '-nostdin', '-i', '/tmp/in.wav']);
  assert.equal(args.includes('-vn'), true);
  assert.equal(args.includes('libmp3lame'), true);
  assert.equal(args.at(-1), '/tmp/out.mp3');
  assert.equal(args.some((arg) => /[;&|]/.test(arg)), false);
  assert.equal(getConvertFormat('flac').ext, 'flac');
  assert.equal(inputExtension('track.m4a'), 'm4a');
  assert.throws(() => getConvertFormat('best;rm'), (error) => error instanceof AppError && error.status === 400);
  assert.throws(() => inputExtension('notes.txt'), (error) => error instanceof AppError && error.status === 400);
});
