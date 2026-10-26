import assert from 'node:assert/strict';
import test from 'node:test';
import { AppError } from '../src/errors.js';
import { createStreamManager } from '../src/services/streams.js';

test('tickets are one-time, expire, and cap concurrent streams', () => {
  let now = 1_000;
  const streams = createStreamManager({ maxConcurrent: 1, ttlMs: 50, now: () => now });
  const id = streams.issue({ url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', source: 'youtube', format: 'audio' });
  assert.throws(() => streams.consume('not-a-uuid'), (error) => error instanceof AppError && error.code === 'invalid_id');
  assert.throws(() => streams.consume('../secret'), (error) => error instanceof AppError && error.code === 'invalid_id');
  const ticket = streams.consume(id);
  assert.equal(ticket.format, 'audio');
  assert.equal(streams.consume(id), null);

  assert.equal(streams.begin(ticket.id), true);
  assert.throws(() => streams.issue({ url: 'x', source: 'youtube', format: 'audio' }), (error) => error.code === 'queue_full');
  streams.end(ticket.id);
  const next = streams.issue({ url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', source: 'youtube', format: 'audio' });
  now += 100;
  assert.equal(streams.consume(next), null);
});
