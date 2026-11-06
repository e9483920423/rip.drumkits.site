import MP3Tag from '/vendor/mp3tag/mp3tag.js';
import { parseBlob } from '/vendor/music-metadata/music-metadata.js';

const TOKEN_STORE = 'rip.drumkits.access-token';
const AUDIO_NAME = /\.(wav|wave|mp3|m4a|aac|flac|ogg|opus|webm|aiff|aif)$/i;
const AUDIO_TYPE = /^(audio\/|video\/(ogg|webm|mp4))/i;
const EDITABLE = /\.(mp3|m4a|aac|aiff|aif)$/i;
const MAX_BYTES = 120 * 1024 * 1024;

const dropzone = document.getElementById('dropzone');
const dropLabel = document.getElementById('drop-label');
const fileInput = document.getElementById('file');
const statusEl = document.getElementById('status');
const errorEl = document.getElementById('form-error');
const results = document.getElementById('results');
const tagsBox = document.getElementById('tags');
const tagsNote = document.getElementById('tags-note');
const convertBox = document.getElementById('convert');
const convertNote = document.getElementById('convert-note');
const convertError = document.getElementById('convert-error');
const saveBtn = document.getElementById('save-tags');
const convertBtn = document.getElementById('convert-btn');
const convertFormat = document.getElementById('convert-format');
const coverPreview = document.getElementById('cover-preview');
const coverFile = document.getElementById('cover-file');

const tagFields = {
  title: document.getElementById('tag-title'),
  artist: document.getElementById('tag-artist'),
  album: document.getElementById('tag-album'),
  year: document.getElementById('tag-year'),
  track: document.getElementById('tag-track'),
  genre: document.getElementById('tag-genre'),
  comment: document.getElementById('tag-comment'),
};

let selectedFile = null;
let fileBuffer = null;
let editable = false;
let pendingCover = null;
let requestId = 0;
let worker = null;
let audioCtx = null;
let ffmpegOk = true;
let coverUrl = '';

function getWorker() {
  worker ??= new Worker('/audio-worker.js', { type: 'module' });
  return worker;
}

function getAudioContext() {
  audioCtx ??= new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
  return audioCtx;
}

function setError(el, message) {
  if (!message) {
    el.hidden = true;
    el.textContent = '';
    return;
  }
  el.hidden = false;
  el.textContent = message;
}

function setBusy(btn, labelClass, busy, label) {
  btn.classList.toggle('busy', busy);
  if (busy) {
    statusEl.hidden = false;
    statusEl.textContent = label;
  }
}

function dash(value) {
  return value == null || value === '' ? '—' : String(value);
}

function formatBitrate(bps) {
  if (!Number.isFinite(bps) || bps <= 0) return '—';
  const kbps = bps / 1000;
  return `${kbps >= 100 ? Math.round(kbps) : kbps.toFixed(1)} kbps`;
}

function formatHz(value) {
  if (!Number.isFinite(value) || value <= 0) return '—';
  return value >= 1000 ? `${(value / 1000).toFixed(value % 1000 === 0 ? 0 : 1)} kHz` : `${Math.round(value)} Hz`;
}

function formatDb(value, unit) {
  if (!Number.isFinite(value)) return '—';
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(1)} ${unit}`;
}

function isAudioFile(file) {
  return AUDIO_TYPE.test(file.type || '') || AUDIO_NAME.test(file.name || '');
}

function listText(value) {
  if (Array.isArray(value)) {
    return value
      .map((item) => (item && typeof item === 'object' && item.text != null ? item.text : item))
      .filter(Boolean)
      .join(', ');
  }
  return value == null ? '' : String(value);
}

function revokeCover() {
  if (coverUrl) URL.revokeObjectURL(coverUrl);
  coverUrl = '';
}

function showCover(bytes, mime) {
  revokeCover();
  if (!bytes || !bytes.length) {
    coverPreview.hidden = true;
    coverPreview.removeAttribute('src');
    return;
  }
  const blob = new Blob([Uint8Array.from(bytes)], { type: mime || 'image/jpeg' });
  coverUrl = URL.createObjectURL(blob);
  coverPreview.src = coverUrl;
  coverPreview.hidden = false;
}

function setTagEditable(on) {
  editable = on;
  tagsNote.hidden = on;
  for (const el of Object.values(tagFields)) el.disabled = !on;
  coverFile.disabled = !on;
  saveBtn.disabled = !on;
}

function fillTags(values) {
  tagFields.title.value = values.title || '';
  tagFields.artist.value = values.artist || '';
  tagFields.album.value = values.album || '';
  tagFields.year.value = values.year || '';
  tagFields.track.value = values.track || '';
  tagFields.genre.value = values.genre || '';
  tagFields.comment.value = values.comment || '';
}

function channelBuffers(buffer) {
  const channels = [];
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    channels.push(buffer.getChannelData(c).slice());
  }
  return channels;
}

function firstPicture(metadata) {
  const pics = metadata?.common?.picture;
  if (!Array.isArray(pics) || !pics[0]?.data) return null;
  return pics[0];
}

async function measureLoudness(file, id) {
  const bytes = await file.arrayBuffer();
  if (id !== requestId) return null;
  const buffer = await getAudioContext().decodeAudioData(bytes.slice(0));
  if (id !== requestId) return null;
  const channels = channelBuffers(buffer);
  const transfers = channels.map((ch) => ch.buffer);
  return new Promise((resolve, reject) => {
    const w = getWorker();
    const onMessage = (event) => {
      if (event.data?.id !== id) return;
      w.removeEventListener('message', onMessage);
      w.removeEventListener('error', onError);
      if (!event.data.ok) reject(new Error(event.data.error || 'analysis failed.'));
      else resolve(event.data);
    };
    const onError = () => {
      w.removeEventListener('message', onMessage);
      w.removeEventListener('error', onError);
      reject(new Error('analysis worker failed.'));
    };
    w.addEventListener('message', onMessage);
    w.addEventListener('error', onError);
    w.postMessage({ id, channels, sampleRate: buffer.sampleRate }, transfers);
  });
}

function showFormat(metadata) {
  const format = metadata.format || {};
  document.getElementById('file-name').textContent = selectedFile?.name || '';
  document.getElementById('codec').textContent = dash(format.codec);
  document.getElementById('container').textContent = dash(format.container);
  document.getElementById('bitrate').textContent = formatBitrate(format.bitrate);
  document.getElementById('sample-rate').textContent = formatHz(format.sampleRate);
  document.getElementById('bit-depth').textContent = format.bitsPerSample ? `${format.bitsPerSample}-bit` : '—';
  document.getElementById('channels').textContent = dash(format.numberOfChannels);
}

function showLoudness(data) {
  document.getElementById('lufs').textContent = formatDb(data.lufs, 'lufs');
  document.getElementById('true-peak').textContent = formatDb(data.truePeak, 'dbtp');
  document.getElementById('lra').textContent = Number.isFinite(data.lra) ? `${data.lra.toFixed(1)} lu` : '—';
  document.getElementById('replaygain').textContent = formatDb(data.replayGain, 'db');
}

async function inspectFile(file) {
  const id = ++requestId;
  setError(errorEl, '');
  setError(convertError, '');
  results.hidden = true;
  tagsBox.hidden = true;
  convertBox.hidden = true;
  pendingCover = null;
  fileBuffer = await file.arrayBuffer();
  if (id !== requestId) return;

  statusEl.hidden = false;
  statusEl.textContent = 'reading';
  const metadata = await parseBlob(file);
  if (id !== requestId) return;
  showFormat(metadata);
  results.hidden = false;

  const canEdit = EDITABLE.test(file.name || '');
  setTagEditable(canEdit);
  if (canEdit) {
    const tag = new MP3Tag(fileBuffer.slice(0));
    tag.read();
    if (tag.error) throw new Error(tag.error);
    fillTags(tag.tags || {});
    const apic = tag.tags?.v2?.APIC?.[0] || tag.tags?.v2?.PIC?.[0];
    if (apic?.data) showCover(apic.data, apic.format);
    else {
      const pic = firstPicture(metadata);
      showCover(pic?.data, pic?.format);
    }
  } else {
    const common = metadata.common || {};
    fillTags({
      title: common.title || '',
      artist: listText(common.artist),
      album: common.album || '',
      year: common.year ? String(common.year) : '',
      track: common.track?.no ? String(common.track.no) : '',
      genre: listText(common.genre),
      comment: listText(common.comment),
    });
    const pic = firstPicture(metadata);
    showCover(pic?.data, pic?.format);
  }
  tagsBox.hidden = false;
  convertBox.hidden = false;
  convertBtn.disabled = !ffmpegOk;
  convertNote.textContent = ffmpegOk
    ? 'this file is sent to the server, converted, then deleted.'
    : 'ffmpeg is not available on this server.';

  statusEl.textContent = 'measuring';
  try {
    const loudness = await measureLoudness(file, id);
    if (id !== requestId || !loudness) return;
    showLoudness(loudness);
  } catch {
    if (id !== requestId) return;
    showLoudness({});
    document.getElementById('lufs').textContent = '—';
  }
  if (id === requestId) {
    statusEl.hidden = true;
    statusEl.textContent = '';
  }
}

function chooseFile(file) {
  if (!file) return;
  if (!isAudioFile(file)) {
    setError(errorEl, 'drop a wav, mp3, m4a, flac, or ogg file.');
    return;
  }
  if (file.size > MAX_BYTES) {
    setError(errorEl, 'that file is too large to open in the browser.');
    return;
  }
  selectedFile = file;
  dropLabel.textContent = file.name;
  dropzone.classList.add('has-file');
  inspectFile(file).catch((error) => {
    setError(errorEl, error?.message || 'could not read that file.');
    statusEl.hidden = true;
  });
}

function saveTags() {
  if (!editable || !fileBuffer || !selectedFile) return;
  setBusy(saveBtn, 'save-label', true, 'writing');
  saveBtn.disabled = true;
  try {
    const tag = new MP3Tag(fileBuffer.slice(0));
    tag.read();
    if (tag.error) throw new Error(tag.error);
    tag.tags.title = tagFields.title.value;
    tag.tags.artist = tagFields.artist.value;
    tag.tags.album = tagFields.album.value;
    tag.tags.year = tagFields.year.value;
    tag.tags.track = tagFields.track.value;
    tag.tags.genre = tagFields.genre.value;
    tag.tags.comment = tagFields.comment.value;
    if (pendingCover) {
      tag.tags.v2 ??= {};
      tag.tags.v2.APIC = [pendingCover];
    }
    const saved = tag.save({ id3v2: { padding: 0 } });
    if (tag.error) throw new Error(tag.error);
    const out = saved instanceof ArrayBuffer ? saved : saved.buffer.slice(saved.byteOffset, saved.byteOffset + saved.byteLength);
    const blob = new Blob([out], { type: selectedFile.type || 'audio/mpeg' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = selectedFile.name;
    link.click();
    URL.revokeObjectURL(link.href);
    fileBuffer = out;
  } catch (error) {
    setError(errorEl, error?.message || 'could not write tags.');
  } finally {
    saveBtn.classList.remove('busy');
    saveBtn.disabled = !editable;
    statusEl.hidden = true;
  }
}

function readToken() {
  try {
    return localStorage.getItem(TOKEN_STORE) || sessionStorage.getItem(TOKEN_STORE) || '';
  } catch {
    return '';
  }
}

function filenameFromDisposition(header, fallback) {
  const utf = /filename\*=UTF-8''([^;]+)/i.exec(header || '');
  if (utf) {
    try {
      return decodeURIComponent(utf[1]);
    } catch {
      return fallback;
    }
  }
  const plain = /filename="([^"]+)"/i.exec(header || '');
  return plain ? plain[1] : fallback;
}

async function convertSelected() {
  if (!selectedFile || !ffmpegOk) return;
  setError(convertError, '');
  convertBtn.disabled = true;
  convertBtn.classList.add('busy');
  statusEl.hidden = false;
  statusEl.textContent = 'converting';
  try {
    const body = new FormData();
    body.append('format', convertFormat.value);
    body.append('file', selectedFile, selectedFile.name);
    const headers = { 'x-media-request': '1' };
    const token = readToken();
    if (token) headers['x-access-token'] = token;
    const response = await fetch('/api/audio/convert', { method: 'POST', headers, body });
    if (!response.ok) {
      let message = 'the conversion failed.';
      try {
        const payload = await response.json();
        if (payload?.error?.message) message = payload.error.message;
      } catch {
        // Keep the fallback.
      }
      throw new Error(message);
    }
    const blob = await response.blob();
    const name = filenameFromDisposition(response.headers.get('content-disposition'), `audio.${convertFormat.value}`);
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = name;
    link.click();
    URL.revokeObjectURL(link.href);
  } catch (error) {
    setError(convertError, error?.message || 'the conversion failed.');
  } finally {
    convertBtn.classList.remove('busy');
    convertBtn.disabled = !ffmpegOk || !selectedFile;
    statusEl.hidden = true;
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
coverFile.addEventListener('change', async () => {
  const file = coverFile.files?.[0];
  coverFile.value = '';
  if (!file || !editable) return;
  const bytes = Array.from(new Uint8Array(await file.arrayBuffer()));
  pendingCover = {
    format: file.type || 'image/jpeg',
    type: 3,
    description: '',
    data: bytes,
  };
  showCover(bytes, pendingCover.format);
});
saveBtn.addEventListener('click', () => saveTags());
convertBtn.addEventListener('click', () => convertSelected());
getWorker();

fetch('/api/health').then(async (response) => {
  const health = await response.json();
  ffmpegOk = Boolean(health?.tools?.ffmpeg);
  if (!ffmpegOk && selectedFile) {
    convertBtn.disabled = true;
    convertNote.textContent = 'ffmpeg is not available on this server.';
  }
}).catch(() => {});
