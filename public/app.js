const FORMAT_STORE = 'rip.drumkits.format.';
const TOKEN_STORE = 'rip.drumkits.access-token';

const state = {
  health: null,
  inspected: null,
  inspectFailed: false,
};

const els = {
  banner: document.querySelector('#banner'),
  workspace: document.querySelector('#workspace'),
  form: document.querySelector('#inspect-form'),
  url: document.querySelector('#url'),
  tokenRow: document.querySelector('#token-row'),
  accessToken: document.querySelector('#access-token'),
  paste: document.querySelector('#paste'),
  inspect: document.querySelector('#inspect'),
  formError: document.querySelector('#form-error'),
  preview: document.querySelector('#preview'),
  thumb: document.querySelector('#thumb'),
  source: document.querySelector('#source'),
  title: document.querySelector('#title'),
  meta: document.querySelector('#meta'),
  rym: document.querySelector('#rym'),
  tracks: document.querySelector('#tracks'),
  trackList: document.querySelector('#track-list'),
  trackMeta: document.querySelector('#track-meta'),
  selectAll: document.querySelector('#select-all'),
  selectNone: document.querySelector('#select-none'),
  format: document.querySelector('#format'),
  download: document.querySelector('#download'),
  previewError: document.querySelector('#preview-error'),
};

let inspectAbort = null;
let inspectGen = 0;
let inspectTimers = [];
let downloadAbort = null;
let downloadTimers = [];

const INSPECT_SITES = [
  { test: /(?:^|\.)(?:youtube\.com|youtu\.be)$/i, site: 'YouTube', tool: 'yt-dlp' },
  { test: /(?:^|\.)soundcloud\.com$/i, site: 'SoundCloud', tool: 'yt-dlp' },
  { test: /(?:^|\.)(?:spotify\.com|spotify\.link)$/i, site: 'Spotify', tool: 'spotdl' },
  { test: /(?:^|\.)bandcamp\.com$/i, site: 'Bandcamp', tool: 'yt-dlp' },
  { test: /(?:^|\.)vimeo\.com$/i, site: 'Vimeo', tool: 'yt-dlp' },
  { test: /(?:^|\.)twitch\.tv$/i, site: 'Twitch', tool: 'yt-dlp' },
  { test: /(?:^|\.)(?:bilibili\.com|b23\.tv)$/i, site: 'Bilibili', tool: 'yt-dlp' },
  { test: /(?:^|\.)(?:reddit\.com|redd\.it)$/i, site: 'Reddit', tool: 'yt-dlp' },
  { test: /(?:^|\.)(?:x\.com|twitter\.com)$/i, site: 'X', tool: 'yt-dlp' },
  { test: /(?:^|\.)(?:facebook\.com|fb\.watch)$/i, site: 'Facebook', tool: 'yt-dlp' },
  { test: /(?:^|\.)(?:flickr\.com|flic\.kr)$/i, site: 'Flickr', tool: 'yt-dlp' },
  { test: /(?:^|\.)(?:dailymotion\.com|dai\.ly)$/i, site: 'Dailymotion', tool: 'yt-dlp' },
  { test: /(?:^|\.)ted\.com$/i, site: 'TED', tool: 'yt-dlp' },
  { test: /(?:^|\.)(?:peertube\.tv|framatube\.org|tilvids\.com)$/i, site: 'PeerTube', tool: 'yt-dlp' },
];

function show(el, on) {
  el.hidden = !on;
}

function setError(el, message) {
  el.textContent = message || '';
  show(el, Boolean(message));
}

function readStore(storage, key) {
  try {
    return storage.getItem(key) || '';
  } catch {
    return '';
  }
}

function writeStore(storage, key, value) {
  try {
    if (value) storage.setItem(key, value);
    else storage.removeItem(key);
  } catch {
    // Private mode can block web storage.
  }
}

function savedFormat(source) {
  return source ? readStore(localStorage, `${FORMAT_STORE}${source}`) : '';
}

function rememberFormat(source, id) {
  if (source && id) writeStore(localStorage, `${FORMAT_STORE}${source}`, id);
}

function accessToken() {
  return els.accessToken?.value.trim() || readStore(sessionStorage, TOKEN_STORE);
}

async function api(path, options = {}) {
  const headers = { 'x-media-request': '1', ...(options.headers || {}) };
  if (options.body) headers['content-type'] = 'application/json';
  const token = accessToken();
  if (token) headers['x-access-token'] = token;
  const response = await fetch(path, {
    method: options.method || 'GET',
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
    credentials: 'same-origin',
    signal: options.signal,
  });
  if (response.status === 204) return null;
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(data?.error?.message || 'The request failed.');
  }
  return data;
}

function formatDuration(seconds) {
  if (seconds == null) return 'Unknown length';
  const value = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  const remain = value % 60;
  if (hours) return `${hours}:${String(minutes).padStart(2, '0')}:${String(remain).padStart(2, '0')}`;
  return `${minutes}:${String(remain).padStart(2, '0')}`;
}

function actionLabelEl(button) {
  return button.querySelector('.inspect-label, .download-label') || button;
}

function fitActionButton(button) {
  if (window.matchMedia('(max-width: 680px)').matches) {
    button.style.width = '';
    return;
  }
  const label = actionLabelEl(button);
  const styles = getComputedStyle(button);
  const extra = parseFloat(styles.paddingLeft)
    + parseFloat(styles.paddingRight)
    + parseFloat(styles.borderLeftWidth)
    + parseFloat(styles.borderRightWidth);
  const dots = button.classList.contains('busy')
    ? 1.25 * parseFloat(styles.fontSize)
    : 0;
  button.style.width = `${Math.ceil(label.scrollWidth + extra + dots)}px`;
}

function fitInspectButton() {
  fitActionButton(els.inspect);
}

function setActionCopy(button, text) {
  actionLabelEl(button).textContent = text;
  fitActionButton(button);
}

function setInspectCopy(text) {
  setActionCopy(els.inspect, text);
}

function setInspectLabel() {
  setInspectCopy(state.inspectFailed ? 'Retry' : 'Inspect');
}

function inspectHint(raw) {
  let host = '';
  let path = '';
  let list = false;
  try {
    const url = new URL(raw);
    host = url.hostname.replace(/^www\./i, '').toLowerCase();
    path = url.pathname.toLowerCase();
    list = url.searchParams.has('list');
  } catch {
    // Use the raw string only as a last resort.
  }
  const match = INSPECT_SITES.find((row) => row.test.test(host));
  const album = list
    || /\/(playlist|playlists|album|sets|showcase)\b/.test(path)
    || path.includes('/sets/');
  return {
    site: match?.site || '',
    tool: match?.tool || 'yt-dlp',
    album,
  };
}

function stopInspectStatus() {
  for (const id of inspectTimers) clearTimeout(id);
  inspectTimers = [];
  els.inspect.classList.remove('busy');
  els.inspect.removeAttribute('aria-busy');
}

function startInspectStatus(raw) {
  stopInspectStatus();
  const hint = inspectHint(raw);
  const steps = [
    { at: 0, text: 'Checking link' },
    { at: 700, text: hint.site ? `Reaching ${hint.site}` : 'Reaching site' },
    { at: 1600, text: hint.album ? 'Reading album' : 'Reading track' },
    { at: 3500, text: hint.tool === 'spotdl' ? 'Waiting on spotdl' : 'Waiting on yt-dlp' },
  ];
  els.inspect.classList.add('busy');
  els.inspect.setAttribute('aria-busy', 'true');
  els.inspect.disabled = true;
  setInspectCopy(steps[0].text);
  for (const step of steps.slice(1)) {
    const id = setTimeout(() => {
      setInspectCopy(step.text);
    }, step.at);
    inspectTimers.push(id);
  }
}

function renderBanner() {
  const tools = state.health?.tools || {};
  if (!tools.ytdlp && !tools.ffmpeg) {
    els.banner.textContent = 'Media processing is unavailable. Install yt-dlp and FFmpeg, then restart the server.';
  } else if (!tools.ytdlp) {
    els.banner.textContent = 'yt-dlp is not available. Install it and restart to inspect or download media.';
  } else if (!tools.ffmpeg) {
    els.banner.textContent = 'FFmpeg is not available. Conversion and merges will fail until it is installed.';
  } else if (!tools.spotdl) {
    els.banner.textContent = 'spotDL is not available. Install it and restart to inspect or download Spotify links.';
  } else {
    show(els.banner, false);
    return;
  }
  show(els.banner, true);
}

function clearPreview() {
  state.inspected = null;
  els.trackList.replaceChildren();
  show(els.tracks, false);
  show(els.rym, false);
  show(els.preview, false);
  setError(els.previewError, '');
}

function rymSearchUrl(artist, title) {
  return `https://www.google.com/search?q=${encodeURIComponent(`site:rateyourmusic.com ${artist} ${title}`)}`;
}

function canSearchRym(info) {
  const artist = String(info?.uploader || '').trim();
  const title = String(info?.title || '').trim();
  return Boolean(artist && title && title !== 'Untitled');
}

function selectedItems() {
  return [...els.trackList.querySelectorAll('input[type="checkbox"]:checked')].map((input) => ({
    url: input.dataset.url,
    title: input.dataset.title,
  }));
}

function maxZipItems() {
  const value = Number(state.inspected?.info?.maxZipItems);
  return Number.isFinite(value) && value > 0 ? value : 20;
}

function updateDownloadLabel() {
  const playlist = state.inspected?.info?.kind === 'playlist';
  const count = playlist ? selectedItems().length : 1;
  if (playlist) {
    const max = maxZipItems();
    const extra = state.inspected.info.truncated ? ' · list truncated' : '';
    els.trackMeta.textContent = `${count} selected · max ${max}${extra}`;
  }
  if (els.download.classList.contains('busy')) return;
  els.download.disabled = playlist && count === 0;
  setActionCopy(els.download, count > 1 ? 'Download zip' : 'Download');
}

function stopDownloadStatus() {
  for (const id of downloadTimers) clearTimeout(id);
  downloadTimers = [];
  els.download.classList.remove('busy');
  els.download.removeAttribute('aria-busy');
}

function startDownloadStatus({ zip, count, site, tool }) {
  stopDownloadStatus();
  const waiting = tool === 'spotdl' ? 'Waiting on spotdl' : 'Waiting on yt-dlp';
  const steps = zip
    ? [
      { at: 0, text: 'Starting zip' },
      { at: 700, text: count > 1 ? `Fetching ${count} tracks` : 'Fetching tracks' },
      { at: 1600, text: 'Packing zip' },
      { at: 4000, text: waiting },
    ]
    : [
      { at: 0, text: 'Starting download' },
      { at: 700, text: site ? `Fetching ${site}` : 'Fetching audio' },
      { at: 2200, text: waiting },
    ];
  els.download.classList.add('busy');
  els.download.setAttribute('aria-busy', 'true');
  els.download.disabled = true;
  setActionCopy(els.download, steps[0].text);
  for (const step of steps.slice(1)) {
    const id = setTimeout(() => {
      setActionCopy(els.download, step.text);
    }, step.at);
    downloadTimers.push(id);
  }
}

function formatEta(received, total, startedAt) {
  if (!total || received < 8192) return '';
  const elapsed = (Date.now() - startedAt) / 1000;
  if (elapsed < 0.4) return '';
  const rate = received / elapsed;
  const left = (total - received) / rate;
  if (!Number.isFinite(left) || left < 0) return '';
  if (left < 1.5) return 'almost done';
  if (left < 60) return `${Math.max(1, Math.round(left))}s left`;
  const mins = Math.ceil(left / 60);
  return mins === 1 ? '1m left' : `${mins}m left`;
}

function filenameFromDisposition(header) {
  const star = /filename\*=UTF-8''([^;]+)/i.exec(header || '');
  if (star?.[1]) {
    try {
      return decodeURIComponent(star[1]);
    } catch {
      // Fall through to the quoted name.
    }
  }
  const quoted = /filename="([^"]+)"/i.exec(header || '');
  return quoted?.[1] || 'download';
}

function saveBlob(blob, filename) {
  const href = URL.createObjectURL(blob);
  let link = document.querySelector('#download-link');
  if (!link) {
    link = document.createElement('a');
    link.id = 'download-link';
    link.hidden = true;
    link.rel = 'noopener';
    document.body.append(link);
  }
  link.href = href;
  link.setAttribute('download', filename || 'download');
  link.click();
  setTimeout(() => URL.revokeObjectURL(href), 60_000);
}

function renderTracks(info) {
  els.trackList.replaceChildren();
  const entries = info.entries || [];
  if (info.kind !== 'playlist' || !entries.length) {
    show(els.tracks, false);
    return;
  }
  for (const [index, entry] of entries.entries()) {
    const item = document.createElement('li');
    const label = document.createElement('label');
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = index === 0;
    box.dataset.url = entry.url;
    box.dataset.title = entry.title || 'Untitled';
    box.addEventListener('change', () => {
      const selected = selectedItems();
      if (selected.length > maxZipItems()) {
        box.checked = false;
        setError(els.previewError, `Select at most ${maxZipItems()} tracks.`);
        updateDownloadLabel();
        return;
      }
      setError(els.previewError, '');
      updateDownloadLabel();
    });
    const copy = document.createElement('span');
    copy.className = 'track-copy';
    const name = document.createElement('strong');
    name.textContent = entry.title || 'Untitled';
    const length = document.createElement('span');
    length.className = 'muted';
    length.textContent = formatDuration(entry.durationSeconds);
    copy.append(name, length);
    label.append(box, copy);
    item.append(label);
    els.trackList.append(item);
  }
  show(els.tracks, true);
}

function renderPreview(info, requestUrl) {
  state.inspected = { requestUrl, info };
  const labels = {
    youtube: 'YouTube',
    soundcloud: 'SoundCloud',
    spotify: 'Spotify',
    bandcamp: 'Bandcamp',
    vimeo: 'Vimeo',
    twitch: 'Twitch',
    bilibili: 'Bilibili',
    reddit: 'Reddit',
    x: 'X',
    facebook: 'Facebook',
    flickr: 'Flickr',
    peertube: 'PeerTube',
    dailymotion: 'Dailymotion',
    ted: 'TED',
  };
  els.source.textContent = labels[info.source] || info.source || 'Unknown';
  els.title.textContent = info.title || 'Untitled';
  const who = info.uploader ? info.uploader : 'Unknown uploader';
  if (info.kind === 'playlist') {
    const count = (info.entries || []).length;
    const extra = info.truncated ? ' · truncated' : '';
    els.meta.textContent = `${who} · ${count} tracks${extra}`;
  } else {
    els.meta.textContent = `${who} · ${formatDuration(info.durationSeconds)}`;
  }
  if (info.thumbnailUrl) {
    els.thumb.src = info.thumbnailUrl;
    els.thumb.hidden = false;
  } else {
    els.thumb.removeAttribute('src');
    els.thumb.hidden = true;
  }
  show(els.rym, canSearchRym(info));
  els.format.replaceChildren();
  for (const format of info.formats || []) {
    const option = document.createElement('option');
    option.value = format.id;
    option.textContent = format.label;
    els.format.append(option);
  }
  const remembered = savedFormat(info.source);
  if (remembered && [...els.format.options].some((option) => option.value === remembered)) {
    els.format.value = remembered;
  }
  renderTracks(info);
  updateDownloadLabel();
  show(els.preview, true);
}

async function inspect(event) {
  event?.preventDefault?.();
  const requestUrl = els.url.value.trim();
  if (!requestUrl) return;
  const gen = inspectGen + 1;
  inspectGen = gen;
  inspectAbort?.abort();
  inspectAbort = new AbortController();
  setError(els.formError, '');
  setError(els.previewError, '');
  state.inspectFailed = false;
  startInspectStatus(requestUrl);
  try {
    const info = await api('/api/media/info', {
      method: 'POST',
      body: { url: requestUrl },
      signal: inspectAbort.signal,
    });
    if (gen !== inspectGen) return;
    renderPreview(info, requestUrl);
  } catch (error) {
    if (gen !== inspectGen || error.name === 'AbortError') return;
    clearPreview();
    state.inspectFailed = true;
    setError(els.formError, error.message);
  } finally {
    if (gen === inspectGen) {
      stopInspectStatus();
      els.inspect.disabled = false;
      setInspectLabel();
    }
  }
}

async function pullDownload(ticket, { zip }) {
  downloadAbort?.abort();
  downloadAbort = new AbortController();
  const response = await fetch(`/api/media/download/${ticket}`, {
    credentials: 'same-origin',
    signal: downloadAbort.signal,
  });
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new Error(data?.error?.message || 'The download failed.');
  }
  const total = Number(response.headers.get('content-length')) || 0;
  const filename = filenameFromDisposition(response.headers.get('content-disposition'));
  const reader = response.body?.getReader();
  if (!reader) throw new Error('The download failed.');
  const chunks = [];
  let received = 0;
  const startedAt = Date.now();
  for (const id of downloadTimers) clearTimeout(id);
  downloadTimers = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.byteLength;
    const eta = formatEta(received, total, startedAt);
    const saving = zip ? 'Saving zip' : 'Saving file';
    setActionCopy(els.download, eta ? `${saving} · ${eta}` : saving);
  }
  saveBlob(new Blob(chunks, { type: 'application/octet-stream' }), filename);
}

async function download() {
  setError(els.previewError, '');
  if (els.download.classList.contains('busy')) return;
  if (!state.inspected || els.url.value.trim() !== state.inspected.requestUrl) {
    setError(els.previewError, 'Inspect this URL before downloading.');
    return;
  }
  const playlist = state.inspected.info.kind === 'playlist';
  const items = playlist ? selectedItems() : [];
  if (playlist && !items.length) {
    setError(els.previewError, 'Select one or more tracks from this playlist.');
    return;
  }
  rememberFormat(state.inspected.info.source, els.format.value);
  const zip = items.length > 1;
  const hint = inspectHint(els.url.value.trim());
  startDownloadStatus({ zip, count: items.length || 1, site: hint.site, tool: hint.tool });
  try {
    const body = {
      url: state.inspected.info.url,
      format: els.format.value,
      title: state.inspected.info.title,
    };
    if (items.length) body.items = items;
    const data = await api('/api/media/download', { method: 'POST', body });
    await pullDownload(data.ticket, { zip });
  } catch (error) {
    if (error.name === 'AbortError') return;
    setError(els.previewError, error.message);
  } finally {
    stopDownloadStatus();
    els.download.disabled = false;
    updateDownloadLabel();
  }
}

async function boot() {
  state.health = await api('/api/health');
  renderBanner();
  const tokenNeeded = Boolean(state.health?.auth?.required);
  show(els.tokenRow, tokenNeeded);
  if (tokenNeeded && els.accessToken && !els.accessToken.value) {
    els.accessToken.value = readStore(sessionStorage, TOKEN_STORE);
  }
  show(els.workspace, true);
  fitInspectButton();
  fitActionButton(els.download);
}

els.form.addEventListener('submit', inspect);
els.download.addEventListener('click', download);
els.rym.addEventListener('click', () => {
  const info = state.inspected?.info;
  if (!canSearchRym(info)) return;
  window.open(rymSearchUrl(info.uploader.trim(), info.title.trim()), '_blank', 'noopener,noreferrer');
});
els.format.addEventListener('change', () => {
  rememberFormat(state.inspected?.info?.source, els.format.value);
});
els.selectAll.addEventListener('click', () => {
  const max = maxZipItems();
  const boxes = [...els.trackList.querySelectorAll('input[type="checkbox"]')];
  boxes.forEach((box, index) => {
    box.checked = index < max;
  });
  setError(els.previewError, boxes.length > max ? `Select at most ${max} tracks.` : '');
  updateDownloadLabel();
});
els.selectNone.addEventListener('click', () => {
  for (const box of els.trackList.querySelectorAll('input[type="checkbox"]')) box.checked = false;
  setError(els.previewError, '');
  updateDownloadLabel();
});
els.url.addEventListener('input', () => {
  inspectAbort?.abort();
  downloadAbort?.abort();
  inspectGen += 1;
  state.inspectFailed = false;
  stopInspectStatus();
  stopDownloadStatus();
  els.inspect.disabled = false;
  setInspectLabel();
  if (state.inspected && els.url.value.trim() !== state.inspected.requestUrl) clearPreview();
  else updateDownloadLabel();
});
els.accessToken?.addEventListener('change', () => {
  writeStore(sessionStorage, TOKEN_STORE, els.accessToken.value.trim());
});
window.addEventListener('resize', () => {
  fitInspectButton();
  fitActionButton(els.download);
});
els.paste.addEventListener('click', async () => {
  try {
    const text = await navigator.clipboard.readText();
    els.url.value = text.trim();
    els.url.dispatchEvent(new Event('input'));
    els.url.focus();
    if (els.url.value) inspect();
  } catch {
    setError(els.formError, 'Clipboard permission was denied. Paste with the keyboard instead.');
  }
});
boot().catch((error) => {
  els.banner.textContent = error.message || 'The server could not be reached.';
  show(els.banner, true);
});
