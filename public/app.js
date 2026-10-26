const state = {
  health: null,
  inspected: null,
};

const els = {
  banner: document.querySelector('#banner'),
  workspace: document.querySelector('#workspace'),
  form: document.querySelector('#inspect-form'),
  url: document.querySelector('#url'),
  paste: document.querySelector('#paste'),
  inspect: document.querySelector('#inspect'),
  formError: document.querySelector('#form-error'),
  preview: document.querySelector('#preview'),
  thumb: document.querySelector('#thumb'),
  source: document.querySelector('#source'),
  title: document.querySelector('#title'),
  meta: document.querySelector('#meta'),
  tracks: document.querySelector('#tracks'),
  trackList: document.querySelector('#track-list'),
  trackMeta: document.querySelector('#track-meta'),
  selectAll: document.querySelector('#select-all'),
  selectNone: document.querySelector('#select-none'),
  format: document.querySelector('#format'),
  download: document.querySelector('#download'),
  previewError: document.querySelector('#preview-error'),
};

function show(el, on) {
  el.hidden = !on;
}

function setError(el, message) {
  el.textContent = message || '';
  show(el, Boolean(message));
}

async function api(path, options = {}) {
  const headers = { 'x-media-request': '1', ...(options.headers || {}) };
  if (options.body) headers['content-type'] = 'application/json';
  const response = await fetch(path, {
    method: options.method || 'GET',
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
    credentials: 'same-origin',
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

function renderBanner() {
  const tools = state.health?.tools || {};
  if (!tools.ytdlp && !tools.ffmpeg) {
    els.banner.textContent = 'Media processing is unavailable. Install yt-dlp and FFmpeg, then restart the server.';
  } else if (!tools.ytdlp) {
    els.banner.textContent = 'yt-dlp is not available. Install it and restart to inspect or download media.';
  } else if (!tools.ffmpeg) {
    els.banner.textContent = 'FFmpeg is not available. Conversion and merges will fail until it is installed.';
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
  show(els.preview, false);
  setError(els.previewError, '');
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
  els.download.textContent = count > 1 ? 'Download zip' : 'Download';
  els.download.disabled = playlist && count === 0;
  if (playlist) {
    const max = maxZipItems();
    const extra = state.inspected.info.truncated ? ' · list truncated' : '';
    els.trackMeta.textContent = `${count} selected · max ${max}${extra}`;
  }
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
  els.source.textContent = info.source === 'soundcloud' ? 'SoundCloud' : 'YouTube';
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
  els.format.replaceChildren();
  for (const format of info.formats || []) {
    const option = document.createElement('option');
    option.value = format.id;
    option.textContent = format.label;
    els.format.append(option);
  }
  renderTracks(info);
  updateDownloadLabel();
  show(els.preview, true);
}

async function inspect(event) {
  event.preventDefault();
  setError(els.formError, '');
  setError(els.previewError, '');
  const requestUrl = els.url.value.trim();
  els.inspect.disabled = true;
  els.inspect.textContent = 'Downloading…';
  try {
    const info = await api('/api/media/info', { method: 'POST', body: { url: requestUrl } });
    renderPreview(info, requestUrl);
  } catch (error) {
    clearPreview();
    setError(els.formError, error.message);
  } finally {
    els.inspect.disabled = false;
    els.inspect.textContent = 'Inspect';
  }
}

function startBrowserDownload(ticket) {
  const url = `/api/media/download/${ticket}`;
  let link = document.querySelector('#download-link');
  if (!link) {
    link = document.createElement('a');
    link.id = 'download-link';
    link.hidden = true;
    link.rel = 'noopener';
    document.body.append(link);
  }
  link.href = url;
  link.setAttribute('download', '');
  link.click();
}

async function download() {
  setError(els.previewError, '');
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
  els.download.disabled = true;
  els.download.textContent = 'Starting…';
  try {
    const body = {
      url: state.inspected.info.url,
      format: els.format.value,
      title: state.inspected.info.title,
    };
    if (items.length) body.items = items;
    const data = await api('/api/media/download', { method: 'POST', body });
    startBrowserDownload(data.ticket);
  } catch (error) {
    setError(els.previewError, error.message);
  } finally {
    updateDownloadLabel();
  }
}

async function boot() {
  state.health = await api('/api/health');
  renderBanner();
  show(els.workspace, true);
}

els.form.addEventListener('submit', inspect);
els.download.addEventListener('click', download);
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
  if (state.inspected && els.url.value.trim() !== state.inspected.requestUrl) clearPreview();
});
els.paste.addEventListener('click', async () => {
  try {
    const text = await navigator.clipboard.readText();
    els.url.value = text.trim();
    els.url.dispatchEvent(new Event('input'));
    els.url.focus();
  } catch {
    setError(els.formError, 'Clipboard permission was denied. Paste with the keyboard instead.');
  }
});
boot().catch((error) => {
  els.banner.textContent = error.message || 'The server could not be reached.';
  show(els.banner, true);
});
