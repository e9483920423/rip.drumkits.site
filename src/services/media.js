import fs from 'node:fs';
import path from 'node:path';
import { ZipFile } from 'yazl';
import { AppError } from '../errors.js';
import { runProcess as defaultRunProcess } from './process.js';
import { sanitizeFilename, verifyMediaFile } from './storage.js';
import { parseMediaUrl } from './validation.js';

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const SPOTIFY_ID = /^[0-9A-Za-z]{22}$/;
const ART_HOST = /^i\d+\.sndcdn\.com$/;
const ART_HOST_EXACT = new Set([
  'i.scdn.co',
  'mosaic.scdn.co',
  'i.vimeocdn.com',
  'static-cdn.jtvnw.net',
  'preview.redd.it',
  'external-preview.redd.it',
  'i.redd.it',
  'b.thumbs.redditmedia.com',
  'pbs.twimg.com',
  'live.staticflickr.com',
  'pi.tedcdn.com',
  'images.ted.com',
]);
const ART_HOST_RE = [
  /^i\d+\.hdslb\.com$/,
  /^scontent[a-z0-9.-]*\.fbcdn\.net$/,
  /^external[a-z0-9.-]*\.xx\.fbcdn\.net$/,
  /^farm\d+\.staticflickr\.com$/,
  /^s\d+\.dmcdn\.net$/,
  /^[fs]\d+\.bcbits\.com$/,
];

export const FORMATS = {
  audio: {
    id: 'audio',
    label: 'Audio (M4A)',
    kind: 'audio',
    ext: 'm4a',
    args: ['-f', 'bestaudio[ext=m4a]/bestaudio/best', '-x', '--audio-format', 'm4a', '--no-keep-video'],
  },
  mp3: {
    id: 'mp3',
    label: 'Audio (MP3)',
    kind: 'audio',
    ext: 'mp3',
    args: ['-f', 'bestaudio/best', '-x', '--audio-format', 'mp3', '--no-keep-video'],
  },
  opus: {
    id: 'opus',
    label: 'Audio (Opus)',
    kind: 'audio',
    ext: 'opus',
    args: ['-f', 'bestaudio/best', '-x', '--audio-format', 'opus', '--no-keep-video'],
  },
  flac: {
    id: 'flac',
    label: 'Audio (FLAC)',
    kind: 'audio',
    ext: 'flac',
    args: ['-f', 'bestaudio/best', '-x', '--audio-format', 'flac', '--no-keep-video'],
  },
  mp4: {
    id: 'mp4',
    label: 'Video up to 1080p (MP4)',
    kind: 'video',
    ext: 'mp4',
    args: [
      '-f',
      'bv*[height<=1080][ext=mp4]+ba[ext=m4a]/b[height<=1080][ext=mp4]/bv*[height<=1080]+ba/b[height<=1080]',
      '--merge-output-format',
      'mp4',
    ],
  },
  'mp4-720': {
    id: 'mp4-720',
    label: 'Video up to 720p (MP4)',
    kind: 'video',
    ext: 'mp4',
    args: [
      '-f',
      'bv*[height<=720][ext=mp4]+ba[ext=m4a]/b[height<=720][ext=mp4]/bv*[height<=720]+ba/b[height<=720]',
      '--merge-output-format',
      'mp4',
    ],
  },
};

export function formatsFor(source) {
  const audio = [FORMATS.audio, FORMATS.mp3, FORMATS.opus, FORMATS.flac];
  if (source === 'soundcloud' || source === 'spotify' || source === 'bandcamp') return audio;
  return [...audio, FORMATS.mp4, FORMATS['mp4-720']];
}

export function getFormat(source, formatId) {
  const format = formatsFor(source).find((item) => item.id === formatId);
  if (!format) throw new AppError('unsupported_format', 'Choose a supported format.', 400);
  return format;
}

export function publicFormat(format) {
  return { id: format.id, label: format.label, kind: format.kind };
}

function limitArgs(config) {
  const args = [
    '--no-playlist',
    '--no-warnings',
    '--no-cache-dir',
    '--restrict-filenames',
    '--no-overwrites',
    '--retries', '2',
    '--fragment-retries', '2',
    '--socket-timeout', '30',
    '--max-filesize', `${config.maxFileSizeMb}M`,
    '--match-filter', `duration <=? ${config.maxDurationSeconds}`,
  ];
  if (path.isAbsolute(config.ffmpegPath)) args.push('--ffmpeg-location', config.ffmpegPath);
  return args;
}

export function buildInfoArgs(url, options = {}) {
  if (options.playlist) {
    const args = ['--yes-playlist'];
    // SoundCloud flat entries often omit titles and report duration in milliseconds.
    if (options.flat !== false) args.push('--flat-playlist');
    args.push(
      '--no-warnings',
      '--no-cache-dir',
      '--dump-single-json',
      '--no-download',
      '--no-progress',
      '--socket-timeout', '20',
      '--retries', '1',
      '--playlist-end', String(options.limit || 100),
      url,
    );
    return args;
  }
  return [
    '--no-playlist',
    '--no-warnings',
    '--no-cache-dir',
    '--dump-single-json',
    '--no-download',
    '--no-progress',
    '--socket-timeout', '20',
    '--retries', '1',
    url,
  ];
}

function outputArgs(output) {
  return [
    '--no-part',
    '--no-write-subs',
    '--no-write-thumbnail',
    '--no-write-info-json',
    '--no-progress',
    '-P', 'home:.',
    '-P', 'temp:.',
    '-o', output,
  ];
}

export function buildStreamArgs(config, { url, formatId, source }) {
  const format = getFormat(source, formatId);
  return {
    format,
    args: [
      ...limitArgs(config),
      ...outputArgs('-'),
      ...format.args,
      url,
    ],
  };
}

export function buildFileArgs(config, { url, formatId, source, output }) {
  const format = getFormat(source, formatId);
  return {
    format,
    args: [
      ...limitArgs(config),
      ...outputArgs(output),
      ...format.args,
      url,
    ],
  };
}

export function buildSpotifySaveArgs(url) {
  return [
    'save',
    '--save-file', '-',
    '--log-level', 'ERROR',
    url,
  ];
}

export function buildSpotifyDownloadArgs(config, { url, formatId, output }) {
  const format = getFormat('spotify', formatId);
  const args = [
    'download',
    '--format', format.ext,
    '--output', output,
    '--overwrite', 'force',
    '--log-level', 'ERROR',
    '--threads', '1',
    '--restrict', 'ascii',
    '--bitrate', 'disable',
  ];
  if (path.isAbsolute(config.ffmpegPath)) args.push('--ffmpeg', config.ffmpegPath);
  args.push(url);
  return { format, args };
}

function cleanText(value, max) {
  if (typeof value !== 'string') return null;
  const cleaned = value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  return cleaned ? cleaned.slice(0, max) : null;
}

function artistsFrom(value) {
  if (typeof value === 'string') return cleanText(value, 200);
  if (!Array.isArray(value)) return null;
  const names = value
    .map((item) => (typeof item === 'string' ? item : item && typeof item.name === 'string' ? item.name : ''))
    .map((name) => cleanText(name, 80))
    .filter(Boolean);
  return names.length ? cleanText(names.join(', '), 200) : null;
}

function namesFrom(data) {
  if (!data || typeof data !== 'object') return null;
  return cleanText(data.uploader, 200)
    || cleanText(data.channel, 200)
    || cleanText(data.artist, 200)
    || cleanText(data.album_artist, 200)
    || cleanText(data.creator, 200)
    || cleanText(data.playlist_uploader, 200)
    || artistsFrom(data.artists);
}

function pickUploader(data) {
  return namesFrom(data) || namesFrom(Array.isArray(data?.entries) ? data.entries[0] : null);
}

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function sanitizeArtworkUrl(value) {
  if (typeof value !== 'string' || value.length > 2048) return null;
  let url;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
  if (ART_HOST.test(url.hostname) || ART_HOST_EXACT.has(url.hostname) || ART_HOST_RE.some((pattern) => pattern.test(url.hostname))) {
    return url.href;
  }
  return null;
}

function artworkFrom(data) {
  if (!data || typeof data !== 'object') return null;
  const candidates = [];
  if (typeof data.thumbnail === 'string') candidates.push(data.thumbnail);
  if (Array.isArray(data.thumbnails)) {
    for (const item of data.thumbnails) {
      if (typeof item?.url === 'string') candidates.push(item.url);
    }
  }
  for (let index = candidates.length - 1; index >= 0; index -= 1) {
    const safe = sanitizeArtworkUrl(candidates[index]);
    if (safe) return safe;
  }
  return null;
}

function pickArtwork(data) {
  return artworkFrom(data) || artworkFrom(Array.isArray(data?.entries) ? data.entries[0] : null);
}

const EXTRACTOR_PREFIX = {
  youtube: ['youtube'],
  soundcloud: ['soundcloud'],
  vimeo: ['vimeo'],
  twitch: ['twitch'],
  bilibili: ['bili'],
  reddit: ['reddit'],
  x: ['twitter'],
  facebook: ['facebook'],
  flickr: ['flickr'],
  peertube: ['peertube'],
  dailymotion: ['dailymotion'],
  ted: ['ted'],
  bandcamp: ['bandcamp'],
};

function extractorOk(data, source) {
  const extractor = String(data.extractor_key || data.extractor || '').toLowerCase().replace(/[^a-z]/g, '');
  if (!extractor) return true;
  const prefixes = EXTRACTOR_PREFIX[source];
  if (!prefixes) return false;
  return prefixes.some((prefix) => extractor.startsWith(prefix));
}

function titleFromUrl(url) {
  try {
    const parts = new URL(url).pathname.split('/').filter(Boolean);
    const slug = decodeURIComponent(parts.at(-1) || '');
    if (!slug || slug.toLowerCase() === 'sets') return null;
    return cleanText(slug.replace(/[-_]+/g, ' '), 300);
  } catch {
    return null;
  }
}

function entryTitle(entry, url) {
  return cleanText(entry?.title, 300)
    || cleanText(entry?.fulltitle, 300)
    || cleanText(entry?.track, 300)
    || titleFromUrl(url)
    || 'Untitled';
}

function entryDurationSeconds(entry, source, maxSeconds) {
  let duration = finiteNumber(entry?.duration);
  if (duration === null) {
    const millis = finiteNumber(entry?.duration_ms);
    if (millis !== null) duration = millis / 1000;
  }
  if (duration === null || duration < 0) return null;
  // SoundCloud's API uses milliseconds; flat extracts sometimes leave that value as-is.
  if (source === 'soundcloud' && duration > maxSeconds) {
    const asSeconds = duration / 1000;
    if (asSeconds > 0 && asSeconds <= maxSeconds) duration = asSeconds;
  }
  return Math.round(duration);
}

function canonicalEntry(source, entry) {
  const rawId = entry?.id;
  const id = typeof rawId === 'string' ? rawId : rawId != null ? String(rawId) : '';
  if (source === 'youtube' && VIDEO_ID.test(id)) {
    return { id, url: `https://www.youtube.com/watch?v=${id}` };
  }
  if (source === 'vimeo' && /^\d+$/.test(id)) {
    return { id, url: `https://vimeo.com/${id}` };
  }
  if (source === 'twitch' && /^\d+$/.test(id)) {
    return { id, url: `https://www.twitch.tv/videos/${id}` };
  }
  if (source === 'bilibili' && /^(BV|av)/i.test(id)) {
    return { id, url: `https://www.bilibili.com/video/${id}` };
  }
  for (const candidate of [entry?.webpage_url, entry?.permalink_url, entry?.original_url, entry?.url]) {
    if (typeof candidate !== 'string' || candidate.length > 2048) continue;
    try {
      const parsed = parseMediaUrl(candidate);
      if (parsed.source !== source || parsed.kind === 'playlist') continue;
      return { id: (parsed.id || id).slice(0, 64), url: parsed.url };
    } catch {
      // Try the next candidate from yt-dlp.
    }
  }
  return null;
}

function parsePlaylistPayload(data, source, config) {
  if (!extractorOk(data, source)) {
    throw new AppError('unsupported_url', 'This URL is not a supported media item.', 400);
  }
  const limit = config.maxPlaylistEntries;
  const rawEntries = Array.isArray(data.entries) ? data.entries : [];
  const entries = [];
  for (const entry of rawEntries) {
    if (entries.length >= limit) break;
    if (!entry || typeof entry !== 'object') continue;
    if (entry.is_live === true || entry.live_status === 'is_live') continue;
    const duration = entryDurationSeconds(entry, source, config.maxDurationSeconds);
    if (duration !== null && duration > config.maxDurationSeconds) continue;
    const canonical = canonicalEntry(source, entry);
    if (!canonical) continue;
    entries.push({
      id: canonical.id,
      title: entryTitle(entry, canonical.url),
      durationSeconds: duration,
      url: canonical.url,
    });
  }
  if (!entries.length) {
    throw new AppError('unsupported_url', 'This playlist has no downloadable items.', 422);
  }
  const reported = finiteNumber(data.playlist_count) ?? finiteNumber(data.n_entries) ?? rawEntries.length;
  const truncated = reported > limit || rawEntries.length > limit;
  const firstVideo = entries.find((item) => VIDEO_ID.test(item.id));
  let thumbnailUrl = null;
  if (source === 'youtube' && firstVideo) {
    thumbnailUrl = `https://i.ytimg.com/vi/${firstVideo.id}/hqdefault.jpg`;
  } else {
    thumbnailUrl = pickArtwork(data);
  }
  return {
    kind: 'playlist',
    title: cleanText(data.title, 300) || 'Untitled',
    uploader: pickUploader(data),
    durationSeconds: null,
    thumbnailUrl,
    bytes: null,
    videoId: typeof data.id === 'string' ? data.id.slice(0, 64) : null,
    truncated,
    entries,
  };
}

export function parseInfoPayload(raw, source, config, options = {}) {
  const text = String(raw || '');
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) {
    throw new AppError('bad_metadata', 'Could not read media details.', 502);
  }
  let data;
  try {
    data = JSON.parse(text.slice(start, end + 1));
  } catch {
    throw new AppError('bad_metadata', 'Could not read media details.', 502);
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new AppError('bad_metadata', 'Could not read media details.', 502);
  }
  const isPlaylist = data._type === 'playlist' || Array.isArray(data.entries);
  if (isPlaylist) {
    if (options.kind !== 'playlist') {
      throw new AppError('unsupported_url', 'Playlists are not supported. Submit one video or track.', 400);
    }
    return parsePlaylistPayload(data, source, config);
  }
  if (options.kind === 'playlist') {
    throw new AppError('bad_metadata', 'Could not read playlist details.', 502);
  }
  if (data.is_live === true) {
    throw new AppError('unsupported_url', 'Live streams are not supported.', 400);
  }
  if (!extractorOk(data, source)) {
    throw new AppError('unsupported_url', 'This URL is not a supported media item.', 400);
  }

  const duration = finiteNumber(data.duration);
  const durationSeconds = duration !== null && duration >= 0 ? Math.round(duration) : null;
  if (durationSeconds !== null && durationSeconds > config.maxDurationSeconds) {
    throw new AppError('too_long', 'This media is longer than the configured limit.', 422);
  }
  const bytes = finiteNumber(data.filesize) ?? finiteNumber(data.filesize_approx);
  const maxBytes = config.maxFileSizeMb * 1024 * 1024;
  if (bytes !== null && bytes > maxBytes) {
    throw new AppError('too_large', 'This media is larger than the configured limit.', 413);
  }

  const videoId = typeof data.id === 'string' ? data.id : '';
  let thumbnailUrl = null;
  if (source === 'youtube' && VIDEO_ID.test(videoId)) {
    thumbnailUrl = `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
  } else {
    thumbnailUrl = pickArtwork(data);
  }

  return {
    kind: 'video',
    title: cleanText(data.title, 300) || 'Untitled',
    uploader: pickUploader(data),
    durationSeconds,
    thumbnailUrl,
    bytes: bytes !== null && bytes > 0 ? Math.round(bytes) : null,
    videoId: videoId.slice(0, 64) || null,
    truncated: false,
    entries: [],
  };
}

function extractJsonValue(raw) {
  const text = String(raw || '');
  const trimmed = text.trim();
  if (!trimmed) {
    throw new AppError('bad_metadata', 'Could not read media details.', 502);
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    // Logs may precede the JSON payload.
  }
  const compact = text.indexOf('[{');
  const pretty = text.search(/\[\s*\{/);
  const start = compact !== -1 ? compact : pretty;
  const end = text.lastIndexOf(']');
  if (start === -1 || end <= start) {
    throw new AppError('bad_metadata', 'Could not read media details.', 502);
  }
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    throw new AppError('bad_metadata', 'Could not read media details.', 502);
  }
}

function spotifyTrackId(song) {
  const id = String(song?.song_id || song?.id || '').trim();
  if (SPOTIFY_ID.test(id)) return id;
  if (typeof song?.url !== 'string' || song.url.length > 2048) return '';
  try {
    const parsed = parseMediaUrl(song.url);
    if (parsed.source === 'spotify' && parsed.kind === 'video' && SPOTIFY_ID.test(parsed.id)) {
      return parsed.id;
    }
  } catch {
    // Ignore unusable Spotify metadata URLs.
  }
  return '';
}

function spotifyArtist(song) {
  if (typeof song?.artist === 'string') return cleanText(song.artist, 200);
  if (!Array.isArray(song?.artists)) return null;
  return cleanText(song.artists.filter((name) => typeof name === 'string').join(', '), 200);
}

export function parseSpotifySavePayload(raw, config, options = {}) {
  const data = extractJsonValue(raw);
  const songs = (Array.isArray(data) ? data : data && typeof data === 'object' ? [data] : [])
    .filter((song) => song && typeof song === 'object' && !Array.isArray(song));
  const entries = [];
  for (const song of songs) {
    if (entries.length >= config.maxPlaylistEntries) break;
    const id = spotifyTrackId(song);
    if (!id) continue;
    const duration = finiteNumber(song.duration);
    if (duration !== null && (duration <= 0 || duration > config.maxDurationSeconds)) continue;
    const name = cleanText(song.name || song.title, 300) || 'Untitled';
    const artist = spotifyArtist(song);
    entries.push({
      id,
      title: artist ? `${artist} - ${name}`.slice(0, 300) : name,
      durationSeconds: duration !== null ? Math.round(duration) : null,
      url: `https://open.spotify.com/track/${id}`,
      uploader: artist,
    });
  }
  if (!entries.length) {
    throw new AppError(
      'unsupported_url',
      options.kind === 'playlist' ? 'This playlist has no downloadable items.' : 'This media is unavailable.',
      422,
    );
  }
  const first = songs.find((song) => spotifyTrackId(song) === entries[0].id) || songs[0];
  const thumbnailUrl = sanitizeArtworkUrl(first?.cover_url);
  const truncated = songs.length > config.maxPlaylistEntries;
  if (options.kind === 'playlist') {
    return {
      kind: 'playlist',
      title: cleanText(first?.list_name || first?.album_name, 300) || 'Untitled',
      uploader: entries[0].uploader,
      durationSeconds: null,
      thumbnailUrl,
      bytes: null,
      videoId: typeof first?.album_id === 'string' ? first.album_id.slice(0, 64) : null,
      truncated,
      entries,
    };
  }
  return {
    kind: 'video',
    title: entries[0].title,
    uploader: entries[0].uploader,
    durationSeconds: entries[0].durationSeconds,
    thumbnailUrl,
    bytes: null,
    videoId: entries[0].id,
    truncated: false,
    entries: [],
  };
}

export function parseProgressLine(line) {
  const clean = String(line).replace(/\u001b\[[0-9;]*m/g, '').trim();
  if (!clean.startsWith('MDPROG ')) return null;
  const [downloadedRaw, totalRaw, estimateRaw] = clean.slice('MDPROG '.length).split('|');
  const downloaded = finiteNumber(String(downloadedRaw).trim());
  const total = finiteNumber(String(totalRaw).trim()) || finiteNumber(String(estimateRaw).trim());
  if (downloaded === null || downloaded < 0 || !total || total <= 0) return { percent: null };
  return { percent: Math.max(0, Math.min(100, Math.round((downloaded / total) * 100))) };
}

export function isSuccessfulStreamResult(result = {}) {
  if (!result.started || result.timedOut || result.cancelled || result.tooLarge) return false;
  if (result.code === 0) return true;
  // yt-dlp exits 101 after --max-downloads even when the requested file already finished.
  if (Number(result.code) !== 101) return false;
  const text = String(result.stderr || '').toLowerCase();
  return text.includes('download completed') || text.includes('maximum number of downloads reached');
}

export function classifyProcessFailure(result = {}, tool = 'yt-dlp') {
  if (result.timedOut) return { code: 'timeout', message: 'The download timed out.', status: 504 };
  if (result.cancelled) return { code: 'cancelled', message: 'The download was cancelled.', status: 409 };
  const text = `${result.stderr || ''}\n${result.message || ''}`.toLowerCase();
  if (result.code === 'ENOENT' || text.includes('enoent')) {
    const name = tool === 'spotdl' ? 'spotDL' : tool === 'ffmpeg' ? 'FFmpeg' : 'yt-dlp';
    return { code: 'tools_missing', message: `${name} is not available on this server.`, status: 503 };
  }
  if (text.includes('no space left') || text.includes('enospc')) {
    return { code: 'disk_full', message: 'The server is out of disk space.', status: 507 };
  }
  if (text.includes('429') || text.includes('too many requests') || text.includes('rate-limit') || text.includes('rate limited')) {
    return { code: 'rate_limited', message: 'The source service asked us to slow down. Try again later.', status: 429 };
  }
  if ((text.includes('ffmpeg') || text.includes('ffprobe')) && (text.includes('not found') || text.includes('no such file'))) {
    return { code: 'tools_missing', message: 'FFmpeg is required for this format and was not found.', status: 503 };
  }
  if (/sign in to confirm|login required|please log in|members-only|join this channel|private video|drm/.test(text)) {
    return { code: 'restricted', message: 'This media is restricted.', status: 422 };
  }
  if (text.includes('unsupported url')) {
    return { code: 'unsupported_url', message: 'This URL is not supported.', status: 400 };
  }
  if (text.includes('requested format is not available') || text.includes('no video formats')) {
    return { code: 'unsupported_format', message: 'That format is not available for this media.', status: 422 };
  }
  if (
    text.includes('video unavailable')
    || text.includes('this video is not available')
    || text.includes('unable to download')
    || text.includes('http error 404')
    || text.includes('no results found')
    || text.includes('could not find a match')
    || text.includes("couldn't find a match")
    || text.includes('no songs found')
    || text.includes("couldn't get metadata")
    || text.includes('could not get metadata')
  ) {
    return { code: 'unavailable', message: 'This media is unavailable.', status: 422 };
  }
  if (text.includes('timed out') || text.includes('connection reset') || text.includes('temporary failure') || text.includes('econnreset') || text.includes('etimedout')) {
    return { code: 'network', message: 'The source could not be reached.', status: 502 };
  }
  if (text.includes('permission denied') || text.includes('eacces')) {
    return { code: 'permission', message: 'The server cannot write the download.', status: 500 };
  }
  return { code: 'download_failed', message: 'The download failed.', status: 422 };
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw new AppError('cancelled', 'The download was cancelled.', 409);
}

function throwIfInspectAborted(signal) {
  if (signal?.aborted) throw new AppError('cancelled', 'The request was cancelled.', 400);
}

function remainingMs(deadline) {
  return Math.max(1000, deadline - Date.now());
}

function isSuccessfulFileResult(result, hasFile) {
  if (!hasFile || result?.timedOut || result?.cancelled || result?.tooLarge) return false;
  if (result?.code === 0) return true;
  if (Number(result?.code) !== 101) return false;
  const text = String(result.stderr || '').toLowerCase();
  return text.includes('download completed') || text.includes('maximum number of downloads reached');
}

const SKIP_OUTPUT_EXT = new Set(['part', 'ytdl', 'temp', 'tmp', 'json', 'description', 'jpg', 'jpeg', 'png', 'webp', 'lrc', 'spotdl', 'm3u', 'm3u8']);

function findOutputFile(workDir, prefix, preferredExt, maxBytes) {
  const candidates = [];
  const preferred = path.join(workDir, `${prefix}.${preferredExt}`);
  if (fs.existsSync(preferred)) candidates.push(preferred);
  let names = [];
  try {
    names = fs.readdirSync(workDir);
  } catch {
    names = [];
  }
  for (const name of names) {
    if (!name.startsWith(`${prefix}.`)) continue;
    const ext = path.extname(name).slice(1).toLowerCase();
    if (SKIP_OUTPUT_EXT.has(ext)) continue;
    const full = path.join(workDir, name);
    if (!candidates.includes(full)) candidates.push(full);
  }
  for (const full of candidates) {
    try {
      return { path: full, ...verifyMediaFile(full, maxBytes) };
    } catch {
      // Try the next candidate in the work directory.
    }
  }
  return null;
}

function writeZipToFile(zipfile, zipPath) {
  return new Promise((resolve, reject) => {
    const dest = fs.createWriteStream(zipPath);
    const fail = (error) => {
      dest.destroy();
      reject(error);
    };
    zipfile.outputStream.on('error', fail);
    dest.on('error', fail);
    dest.on('finish', resolve);
    zipfile.outputStream.pipe(dest);
  });
}

function failureFromResult(result, tool) {
  const classified = classifyProcessFailure(result, tool);
  const error = new AppError(classified.code, classified.message, classified.status);
  error.detail = String(result.stderr || '').slice(-400);
  return error;
}

function toolsMissingMessage(source) {
  return source === 'spotify'
    ? 'spotDL is not available on this server.'
    : 'yt-dlp is not available on this server.';
}

function processTool(source) {
  return source === 'spotify' ? 'spotdl' : 'yt-dlp';
}

async function streamFile(filePath, { onFirstByte, write, signal, maxBytes }) {
  const stream = fs.createReadStream(filePath);
  let first = true;
  let bytes = 0;
  try {
    for await (const chunk of stream) {
      if (signal?.aborted) {
        stream.destroy();
        throw new AppError('cancelled', 'The download was cancelled.', 409);
      }
      bytes += chunk.length;
      if (bytes > maxBytes) {
        stream.destroy();
        throw new AppError('too_large', 'The file is larger than the configured limit.', 413);
      }
      if (first) {
        first = false;
        onFirstByte?.(chunk);
      } else {
        write?.(chunk);
      }
    }
  } catch (error) {
    stream.destroy();
    throw error;
  }
  return bytes;
}

async function probeCommand(command, run, versionArgs) {
  try {
    const result = await run(command, versionArgs, { timeoutMs: 8000, stdoutCap: 4000 });
    return result.code === 0;
  } catch {
    return false;
  }
}

function isBareCommand(command) {
  return typeof command === 'string' && !/[\\/]/.test(command);
}

async function whereCandidates(command, run) {
  if (process.platform !== 'win32' || !isBareCommand(command)) return [];
  try {
    const result = await run('where.exe', [command], { timeoutMs: 4000, stdoutCap: 8000 });
    if (result.code !== 0) return [];
    return String(result.stdout || '')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.toLowerCase().startsWith('info:'));
  } catch {
    return [];
  }
}

async function resolveTool(command, run, versionArgs) {
  if (await probeCommand(command, run, versionArgs)) return { ok: true, path: command };
  for (const candidate of await whereCandidates(command, run)) {
    if (await probeCommand(candidate, run, versionArgs)) return { ok: true, path: candidate };
  }
  return { ok: false, path: command };
}

export function createMediaService(config, deps = {}) {
  const run = deps.runProcess || defaultRunProcess;

  async function probe() {
    const [ytdlp, ffmpeg, spotdl] = await Promise.all([
      resolveTool(config.ytdlpPath, run, ['--version']),
      resolveTool(config.ffmpegPath, run, ['-version']),
      resolveTool(config.spotdlPath, run, ['--version']),
    ]);
    if (ytdlp.ok && ytdlp.path !== config.ytdlpPath) config.ytdlpPath = ytdlp.path;
    if (ffmpeg.ok && path.isAbsolute(ffmpeg.path)) config.ffmpegPath = ffmpeg.path;
    if (spotdl.ok && spotdl.path !== config.spotdlPath) config.spotdlPath = spotdl.path;
    return { ytdlp: ytdlp.ok, ffmpeg: ffmpeg.ok, spotdl: spotdl.ok };
  }

  async function inspect(url, source, signal, options = {}) {
    throwIfInspectAborted(signal);
    const playlist = options.kind === 'playlist';
    const command = source === 'spotify' ? config.spotdlPath : config.ytdlpPath;
    const args = source === 'spotify'
      ? buildSpotifySaveArgs(url)
      : buildInfoArgs(url, {
        playlist,
        flat: playlist && source !== 'soundcloud' && source !== 'bandcamp',
        limit: config.maxPlaylistEntries,
      });
    let result;
    try {
      result = await run(command, args, {
        timeoutMs: Math.min(config.jobTimeoutSeconds, playlist ? (source === 'soundcloud' || source === 'bandcamp' ? 120 : 90) : 60) * 1000,
        stdoutCap: playlist ? 8_000_000 : undefined,
        signal,
      });
    } catch (error) {
      if (signal?.aborted) throw new AppError('cancelled', 'The request was cancelled.', 400);
      if (error.code === 'ENOENT') throw new AppError('tools_missing', toolsMissingMessage(source), 503);
      throw new AppError('download_failed', 'Could not read media details.', 502);
    }
    if (signal?.aborted || result.cancelled) throw new AppError('cancelled', 'The request was cancelled.', 400);
    if (result.timedOut) throw new AppError('timeout', 'Metadata lookup timed out.', 504);
    if (result.code !== 0) throw failureFromResult(result, processTool(source));
    if (source === 'spotify') {
      return parseSpotifySavePayload(result.stdout, config, { kind: playlist ? 'playlist' : 'video' });
    }
    return parseInfoPayload(result.stdout, source, config, { kind: playlist ? 'playlist' : 'video' });
  }

  async function stream({ url, source, format, workDir, signal, onReady, onFirstByte, write }) {
    throwIfAborted(signal);
    const file = await downloadToFile({
      url,
      source,
      format,
      workDir,
      prefix: '01',
      signal,
      timeoutMs: config.jobTimeoutSeconds * 1000,
    });
    onReady?.({ bytes: file.bytes, ext: file.ext });
    const bytes = await streamFile(file.path, {
      onFirstByte,
      write,
      signal,
      maxBytes: config.maxFileSizeMb * 1024 * 1024,
    });
    return { bytes, ext: file.ext };
  }

  async function downloadToFile({ url, source, format, workDir, prefix, signal, timeoutMs }) {
    throwIfAborted(signal);
    if (!/^[A-Za-z0-9_-]{1,32}$/.test(prefix)) {
      throw new AppError('download_failed', 'The download failed.', 422);
    }
    const built = source === 'spotify'
      ? buildSpotifyDownloadArgs(config, { url, formatId: format, output: `${prefix}.{output-ext}` })
      : buildFileArgs(config, {
        url,
        formatId: format,
        source,
        output: `${prefix}.%(ext)s`,
      });
    const command = source === 'spotify' ? config.spotdlPath : config.ytdlpPath;
    const maxBytes = config.maxFileSizeMb * 1024 * 1024;
    let result;
    try {
      result = await run(command, built.args, {
        cwd: workDir,
        timeoutMs,
        signal,
      });
    } catch (error) {
      if (signal?.aborted) throw new AppError('cancelled', 'The download was cancelled.', 409);
      if (error.code === 'ENOENT') throw new AppError('tools_missing', toolsMissingMessage(source), 503);
      throw new AppError('download_failed', 'The download failed.', 422);
    }
    if (signal?.aborted || result.cancelled) throw new AppError('cancelled', 'The download was cancelled.', 409);
    if (result.timedOut) throw new AppError('timeout', 'The download timed out.', 504);
    const found = findOutputFile(workDir, prefix, built.format.ext, maxBytes);
    if (!isSuccessfulFileResult(result, Boolean(found))) {
      if (!found || result.code) throw failureFromResult(result, processTool(source));
      throw new AppError('invalid_output', 'The download finished without a valid file.', 422);
    }
    return found;
  }

  async function zip({ items, source, format, workDir, signal, onReady, onFirstByte, write }) {
    throwIfAborted(signal);
    const zipfile = new ZipFile();
    const zipPath = path.join(workDir, 'archive.zip');
    const written = writeZipToFile(zipfile, zipPath);
    const failures = [];
    const deadline = Date.now() + config.jobTimeoutSeconds * 1000;
    const maxZipBytes = config.maxZipSizeMb * 1024 * 1024;
    let totalBytes = 0;
    let added = 0;
    let sizeCapped = false;

    for (const [index, item] of items.entries()) {
      throwIfAborted(signal);
      const label = item.title || `track ${index + 1}`;
      if (sizeCapped) {
        failures.push(`${label}: zip size limit reached`);
        continue;
      }
      const prefix = String(index + 1).padStart(2, '0');
      try {
        const file = await downloadToFile({
          url: item.url,
          source,
          format,
          workDir,
          prefix,
          signal,
          timeoutMs: remainingMs(deadline),
        });
        if (totalBytes + file.bytes > maxZipBytes) {
          sizeCapped = true;
          failures.push(`${label}: zip size limit reached`);
          continue;
        }
        const name = `${prefix}-${sanitizeFilename(item.title)}.${file.ext}`;
        zipfile.addFile(file.path, name);
        totalBytes += file.bytes;
        added += 1;
      } catch (error) {
        if (error instanceof AppError && error.code === 'cancelled') {
          zipfile.outputStream.destroy();
          await written.catch(() => {});
          throw error;
        }
        const message = error instanceof AppError ? error.message : 'The download failed.';
        failures.push(`${label}: ${message}`);
      }
    }

    if (added === 0) {
      zipfile.outputStream.destroy();
      await written.catch(() => {});
      throw new AppError('download_failed', failures[0] || 'The download failed.', 422);
    }
    if (failures.length) {
      zipfile.addBuffer(Buffer.from(`${failures.join('\n')}\n`, 'utf8'), 'failed.txt');
    }
    zipfile.end();
    await written;
    const size = fs.statSync(zipPath).size;
    onReady?.({ bytes: size, ext: 'zip' });
    await streamFile(zipPath, {
      onFirstByte,
      write,
      signal,
      maxBytes: maxZipBytes,
    });
    return { bytes: size, ext: 'zip' };
  }

  return { probe, inspect, stream, zip };
}
