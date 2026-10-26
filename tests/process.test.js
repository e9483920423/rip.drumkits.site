import assert from 'node:assert/strict';
import test from 'node:test';
import { runProcess, streamProcess } from '../src/services/process.js';

test('captures a non-zero exit without a shell', async () => {
  const result = await runProcess(process.execPath, ['-e', 'console.error("boom"); process.exit(2)'], {
    timeoutMs: 5000,
  });
  assert.equal(result.code, 2);
  assert.match(result.stderr, /boom/);
  assert.equal(result.timedOut, false);
});

test('reports a missing executable', async () => {
  await assert.rejects(
    () => runProcess('md-missing-binary-xyz', ['--version'], { timeoutMs: 3000 }),
    (error) => error.code === 'ENOENT',
  );
});

test('streams stdout without buffering the whole payload', async () => {
  const chunks = [];
  const result = await streamProcess(process.execPath, ['-e', "process.stdout.write(Buffer.from('ftypxxxx'))"], {
    timeoutMs: 5000,
    onFirstByte(chunk) { chunks.push(chunk); },
    write(chunk) { chunks.push(chunk); },
  });
  assert.equal(result.code, 0);
  assert.equal(result.started, true);
  assert.equal(Buffer.concat(chunks).toString('ascii'), 'ftypxxxx');
});

test('times out and cancels a child process', { timeout: 30000 }, async () => {
  const timed = await runProcess(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { timeoutMs: 400 });
  assert.equal(timed.timedOut, true);

  const controller = new AbortController();
  const pending = runProcess(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
    timeoutMs: 10000,
    signal: controller.signal,
  });
  setTimeout(() => controller.abort(), 100);
  const cancelled = await pending;
  assert.equal(cancelled.cancelled, true);
});
