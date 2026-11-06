const dropzone = document.getElementById('dropzone');
const dropLabel = document.getElementById('drop-label');
const fileInput = document.getElementById('file');
const analyzeBtn = document.getElementById('analyze-btn');
const statusEl = document.getElementById('status');
const errorEl = document.getElementById('form-error');
const results = document.getElementById('results');

const AUDIO_NAME = /\.(wav|wave|mp3|m4a|aac|flac|ogg|opus|webm)$/i;
const AUDIO_TYPE = /^(audio\/|video\/(ogg|webm|mp4))/i;
const MAX_BYTES = 120 * 1024 * 1024;

let selectedFile = null;
let requestId = 0;
let worker = null;
let audioCtx = null;

function getWorker() {
  if (!worker) {
    worker = new Worker('/analyze-worker.js', { type: 'module' });
  }
  return worker;
}

function getAudioContext() {
  audioCtx ??= new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === 'suspended') {
    audioCtx.resume().catch(() => {});
  }
  return audioCtx;
}

function setError(message) {
  if (!message) {
    errorEl.hidden = true;
    errorEl.textContent = '';
    return;
  }
  errorEl.hidden = false;
  errorEl.textContent = message;
}

function setBusy(busy, label) {
  analyzeBtn.disabled = busy || !selectedFile;
  analyzeBtn.classList.toggle('busy', busy);
  if (busy) {
    statusEl.hidden = false;
    statusEl.textContent = label;
  } else {
    statusEl.hidden = true;
    statusEl.textContent = '';
  }
}

function isAudioFile(file) {
  return AUDIO_TYPE.test(file.type || '') || AUDIO_NAME.test(file.name || '');
}

function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '—';
  const total = Math.round(seconds);
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  return `${minutes}:${String(rest).padStart(2, '0')}`;
}

function formatBpm(bpm) {
  if (!Number.isFinite(bpm) || bpm <= 0) return '—';
  const rounded = Math.round(bpm * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

function formatKey(key) {
  if (!key) return '—';
  return key.name || key.shortName || '—';
}

function formatLufs(value) {
  if (!Number.isFinite(value)) return '—';
  return `${value.toFixed(1)} lufs`;
}

function formatConfidence(value) {
  if (!Number.isFinite(value)) return '—';
  return `${Math.round(value * 100)}%`;
}

function mixMono(buffer) {
  const frames = buffer.length;
  const channels = buffer.numberOfChannels;
  if (channels === 1) return buffer.getChannelData(0).slice();
  const out = new Float32Array(frames);
  for (let c = 0; c < channels; c++) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < frames; i++) out[i] += data[i];
  }
  const scale = 1 / channels;
  for (let i = 0; i < frames; i++) out[i] *= scale;
  return out;
}

function interleave(buffer) {
  const channels = buffer.numberOfChannels;
  const frames = buffer.length;
  if (channels === 1) return buffer.getChannelData(0).slice();
  const out = new Float32Array(frames * channels);
  const chans = [];
  for (let c = 0; c < channels; c++) chans.push(buffer.getChannelData(c));
  let offset = 0;
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < channels; c++) out[offset++] = chans[c][i];
  }
  return out;
}

function chooseFile(file) {
  if (!file) return;
  if (!isAudioFile(file)) {
    setError('drop a wav, mp3, m4a, flac, or ogg file.');
    return;
  }
  if (file.size > MAX_BYTES) {
    setError('that file is too large to analyze in the browser.');
    return;
  }
  selectedFile = file;
  dropLabel.textContent = file.name;
  dropzone.classList.add('has-file');
  analyzeBtn.disabled = false;
  setError('');
  results.hidden = true;
  analyzeSelected();
}

function showResults(data, fileName, duration) {
  document.getElementById('file-name').textContent = fileName;
  document.getElementById('bpm').textContent = formatBpm(data.bpm);
  document.getElementById('key').textContent = formatKey(data.key);
  document.getElementById('duration').textContent = formatDuration(duration);
  document.getElementById('lufs').textContent = formatLufs(data.lufs);
  document.getElementById('confidence').textContent = formatConfidence(data.key?.confidence);
  results.hidden = false;
}

async function analyzeSelected() {
  const file = selectedFile;
  if (!file) return;
  const id = ++requestId;
  setError('');
  results.hidden = true;
  setBusy(true, 'decoding');
  try {
    const bytes = await file.arrayBuffer();
    if (id !== requestId) return;
    const buffer = await getAudioContext().decodeAudioData(bytes.slice(0));
    if (id !== requestId) return;
    if (!buffer.length) throw new Error('empty');
    setBusy(true, 'analyzing');
    const samples = mixMono(buffer);
    const interleaved = buffer.numberOfChannels === 1 ? samples : interleave(buffer);
    const transfers = buffer.numberOfChannels === 1 ? [samples.buffer] : [samples.buffer, interleaved.buffer];
    await new Promise((resolve, reject) => {
      const w = getWorker();
      const onMessage = (event) => {
        if (event.data?.id !== id) return;
        w.removeEventListener('message', onMessage);
        w.removeEventListener('error', onError);
        if (!event.data.ok) {
          reject(new Error(event.data.error || 'analysis failed.'));
          return;
        }
        showResults(event.data, file.name, buffer.duration);
        resolve();
      };
      const onError = () => {
        w.removeEventListener('message', onMessage);
        w.removeEventListener('error', onError);
        reject(new Error('analysis worker failed.'));
      };
      w.addEventListener('message', onMessage);
      w.addEventListener('error', onError);
      w.postMessage({
        id,
        samples,
        sampleRate: buffer.sampleRate,
        channels: buffer.numberOfChannels,
        interleaved,
      }, transfers);
    });
  } catch (error) {
    if (id !== requestId) return;
    const message = String(error?.message || '');
    if (/decode|encoding|empty/i.test(message) || error?.name === 'EncodingError') {
      setError('could not decode that file in this browser.');
    } else {
      setError(message || 'analysis failed.');
    }
  } finally {
    if (id === requestId) setBusy(false);
  }
}

dropzone.addEventListener('click', () => fileInput.click());
dropzone.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    fileInput.click();
  }
});
dropzone.addEventListener('dragenter', (event) => {
  event.preventDefault();
  dropzone.classList.add('drag');
});
dropzone.addEventListener('dragover', (event) => {
  event.preventDefault();
  dropzone.classList.add('drag');
});
dropzone.addEventListener('dragleave', () => dropzone.classList.remove('drag'));
dropzone.addEventListener('drop', (event) => {
  event.preventDefault();
  dropzone.classList.remove('drag');
  chooseFile(event.dataTransfer?.files?.[0]);
});
fileInput.addEventListener('change', () => {
  chooseFile(fileInput.files?.[0]);
  fileInput.value = '';
});
analyzeBtn.addEventListener('click', () => analyzeSelected());
getWorker();
