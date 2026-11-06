import { lra, lufs, replaygain, truepeak } from '/vendor/loudness/loudness.js';

self.addEventListener('message', (event) => {
  const { id, channels, sampleRate } = event.data || {};
  try {
    if (!Array.isArray(channels) || !channels.length || !Number.isFinite(sampleRate) || sampleRate <= 0) {
      throw new Error('audio buffer is invalid.');
    }
    const opts = { fs: sampleRate };
    const integrated = lufs(channels, opts);
    const peak = truepeak(channels, opts);
    const range = lra(channels, opts);
    const gain = replaygain(channels, opts);
    self.postMessage({
      id,
      ok: true,
      lufs: integrated,
      truePeak: peak,
      lra: range,
      replayGain: gain && Number.isFinite(gain.gain) ? gain.gain : null,
    });
  } catch (error) {
    self.postMessage({
      id,
      ok: false,
      error: error instanceof Error ? error.message : 'analysis failed.',
    });
  }
});
