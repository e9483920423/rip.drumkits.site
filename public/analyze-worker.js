import { detectBpm, detectKey, init, lufsInterleaved } from '/vendor/libsonare/analysis.js';

const ready = init();

function integratedLufs(result) {
  if (!result || typeof result !== 'object') return null;
  const value = result.integratedLufs;
  return Number.isFinite(value) ? value : null;
}

self.addEventListener('message', async (event) => {
  const { id, samples, sampleRate, channels, interleaved } = event.data || {};
  try {
    if (!(samples instanceof Float32Array) || !Number.isFinite(sampleRate) || sampleRate <= 0) {
      throw new Error('audio buffer is invalid.');
    }
    await ready;
    const bpm = detectBpm(samples, sampleRate);
    const key = detectKey(samples, sampleRate, { tuning: 'auto', modes: 'major-minor' });
    let lufs = null;
    if (interleaved instanceof Float32Array && Number.isInteger(channels) && channels > 0) {
      lufs = integratedLufs(lufsInterleaved(interleaved, channels, sampleRate));
    }
    self.postMessage({
      id,
      ok: true,
      bpm,
      key: {
        name: key.name,
        shortName: key.shortName,
        mode: key.mode,
        confidence: key.confidence,
      },
      lufs,
    });
  } catch (error) {
    self.postMessage({
      id,
      ok: false,
      error: error instanceof Error ? error.message : 'analysis failed.',
    });
  }
});
