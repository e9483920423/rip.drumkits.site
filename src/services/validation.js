import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { AppError } from '../errors.js';

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const YOUTUBE_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtu.be',
  'youtube-nocookie.com',
  'www.youtube-nocookie.com',
]);
const SOUNDCLOUD_HOSTS = new Set([
  'soundcloud.com',
  'www.soundcloud.com',
  'm.soundcloud.com',
  'on.soundcloud.com',
]);
const SOUNDCLOUD_RESERVED = new Set([
  'discover',
  'feed',
  'search',
  'you',
  'stream',
  'pages',
  'people',
  'groups',
  'mobile',
  'messages',
  'notifications',
  'upload',
  'settings',
  'popular',
  'charts',
  'terms-of-use',
  'imprint',
  'premium',
]);
const REDIRECT_STATUS = new Set([301, 302, 303, 307, 308]);

function ipv4ToInt(address) {
  const parts = address.split('.').map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return null;
  }
  return (((parts[0] << 24) >>> 0) + (parts[1] << 16) + (parts[2] << 8) + parts[3]) >>> 0;
}

function inCidr(address, base, bits) {
  const ip = ipv4ToInt(address);
  const network = ipv4ToInt(base);
  if (ip === null || network === null) return false;
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (ip & mask) === (network & mask);
}

function isPublicV4(address) {
  const blocked = [
    ['0.0.0.0', 8],
    ['10.0.0.0', 8],
    ['100.64.0.0', 10],
    ['127.0.0.0', 8],
    ['169.254.0.0', 16],
    ['172.16.0.0', 12],
    ['192.0.0.0', 24],
    ['192.0.2.0', 24],
    ['192.168.0.0', 16],
    ['198.18.0.0', 15],
    ['198.51.100.0', 24],
    ['203.0.113.0', 24],
    ['224.0.0.0', 4],
    ['240.0.0.0', 4],
  ];
  if (address === '255.255.255.255') return false;
  return !blocked.some(([base, bits]) => inCidr(address, base, bits));
}

function ipv6Hextets(address) {
  let lower = address.toLowerCase();
  const lastColon = lower.lastIndexOf(':');
  const tail = lastColon >= 0 ? lower.slice(lastColon + 1) : lower;
  if (net.isIP(tail) === 4) {
    const [a, b, c, d] = tail.split('.').map(Number);
    const hex = `${((a << 8) + b).toString(16)}:${((c << 8) + d).toString(16)}`;
    lower = `${lower.slice(0, lastColon + 1)}${hex}`;
  }
  const pieces = lower.split('::');
  if (pieces.length > 2) return null;
  const headParts = pieces[0] ? pieces[0].split(':') : [];
  if (pieces.length === 1) {
    return headParts.length === 8 ? headParts : null;
  }
  const tailParts = pieces[1] ? pieces[1].split(':') : [];
  const missing = 8 - (headParts.length + tailParts.length);
  if (missing < 0) return null;
  return [...headParts, ...Array(missing).fill('0'), ...tailParts];
}

function isMappedV4(parts) {
  const prefix = parts.slice(0, 5).every((part) => Number.parseInt(part, 16) === 0);
  return prefix && Number.parseInt(parts[5], 16) === 0xffff;
}

function isPublicV6(address) {
  const parts = ipv6Hextets(address);
  if (!parts || parts.length !== 8) return false;
  if (isMappedV4(parts)) {
    const high = Number.parseInt(parts[6], 16);
    const low = Number.parseInt(parts[7], 16);
    if (!Number.isFinite(high) || !Number.isFinite(low)) return false;
    return isPublicV4(`${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`);
  }
  const first = Number.parseInt(parts[0], 16);
  if (!Number.isFinite(first)) return false;
  if (parts.every((part) => Number.parseInt(part, 16) === 0)) return false;
  if (parts.slice(0, 7).every((part) => Number.parseInt(part, 16) === 0) && Number.parseInt(parts[7], 16) === 1) {
    return false;
  }
  if ((first & 0xfe00) === 0xfc00) return false;
  if ((first & 0xffc0) === 0xfe80) return false;
  if ((first & 0xff00) === 0xff00) return false;
  if (first === 0x2001 && Number.parseInt(parts[1], 16) === 0x0db8) return false;
  return true;
}

export function isPublicAddress(address) {
  const family = net.isIP(address);
  if (family === 4) return isPublicV4(address);
  if (family === 6) return isPublicV6(address);
  return false;
}

function hostnameOf(value) {
  return String(value || '').toLowerCase().replace(/\.$/, '');
}

function sourceFor(hostname) {
  if (YOUTUBE_HOSTS.has(hostname)) return 'youtube';
  if (SOUNDCLOUD_HOSTS.has(hostname)) return 'soundcloud';
  return '';
}

function invalid(message = 'Enter a valid YouTube or SoundCloud URL.') {
  return new AppError('invalid_url', message, 400);
}

function unsupported(message = 'This URL is not a supported YouTube or SoundCloud item.') {
  return new AppError('unsupported_url', message, 400);
}

function decodePart(part) {
  try {
    return decodeURIComponent(part);
  } catch {
    throw invalid();
  }
}

function assertSegment(segment) {
  if (!segment || segment === '.' || segment === '..' || segment.length > 200) throw unsupported();
  if (/[\u0000-\u001f\u007f\\/#?]/.test(segment)) throw unsupported();
}

const PLAYLIST_ID = /^[A-Za-z0-9_-]{10,128}$/;

function canonicalYoutube(id) {
  return `https://www.youtube.com/watch?v=${id}`;
}

function canonicalYoutubePlaylist(id) {
  return `https://www.youtube.com/playlist?list=${id}`;
}

function assertYoutubePlaylistId(list) {
  const upper = String(list || '').toUpperCase();
  if (upper.startsWith('RD')) {
    throw unsupported('YouTube mixes and radio playlists are not supported.');
  }
  if (upper === 'WL' || upper === 'LL') {
    throw unsupported('Watch Later and Liked videos are not supported.');
  }
  if (!PLAYLIST_ID.test(list)) {
    throw invalid('That YouTube playlist URL is missing a playlist id.');
  }
  return list;
}

function parseYoutube(url, hostname) {
  const parts = url.pathname.split('/').filter(Boolean).map(decodePart);
  if (hostname === 'youtu.be') {
    if (parts.length !== 1 || !VIDEO_ID.test(parts[0])) {
      throw unsupported('Submit one YouTube video URL.');
    }
    return { url: canonicalYoutube(parts[0]), source: 'youtube', id: parts[0], kind: 'video' };
  }
  const head = (parts[0] || '').toLowerCase();
  if (head === 'playlist') {
    if (parts.length !== 1) throw unsupported('Submit a YouTube playlist URL.');
    const id = assertYoutubePlaylistId(url.searchParams.get('list') || '');
    return { url: canonicalYoutubePlaylist(id), source: 'youtube', id, kind: 'playlist' };
  }
  if (!head || head.startsWith('@') || ['channel', 'c', 'user', 'results', 'feed', 'watch_videos'].includes(head)) {
    throw unsupported('Channels and search pages are not supported. Submit a video or playlist.');
  }
  if (head === 'watch') {
    if (parts.length !== 1) throw unsupported('Submit one YouTube video URL.');
    const id = url.searchParams.get('v') || '';
    if (!VIDEO_ID.test(id)) throw invalid('That YouTube URL is missing a video id.');
    return { url: canonicalYoutube(id), source: 'youtube', id, kind: 'video' };
  }
  if (['shorts', 'embed', 'live', 'v'].includes(head)) {
    if (parts.length !== 2 || !VIDEO_ID.test(parts[1])) throw unsupported('Submit one YouTube video URL.');
    return { url: canonicalYoutube(parts[1]), source: 'youtube', id: parts[1], kind: 'video' };
  }
  throw unsupported('Submit one YouTube video URL.');
}

function parseSoundCloud(url, hostname) {
  const parts = url.pathname.split('/').filter(Boolean).map(decodePart);
  if (hostname === 'on.soundcloud.com') {
    if (parts.length !== 1 || !/^[A-Za-z0-9]+$/.test(parts[0])) {
      throw unsupported('Submit one SoundCloud track URL.');
    }
    return { url: `https://on.soundcloud.com/${parts[0]}`, source: 'soundcloud', id: parts[0], kind: 'video', short: true };
  }
  if (parts.length === 3 && parts[1].toLowerCase() === 'sets') {
    const [user, , set] = parts;
    assertSegment(user);
    assertSegment(set);
    if (SOUNDCLOUD_RESERVED.has(user.toLowerCase())) throw unsupported('Submit a SoundCloud set or track URL.');
    return {
      url: `https://soundcloud.com/${encodeURIComponent(user)}/sets/${encodeURIComponent(set)}`,
      source: 'soundcloud',
      id: set,
      kind: 'playlist',
      short: false,
    };
  }
  if (parts.some((part) => part.toLowerCase() === 'sets')) {
    throw unsupported('Submit a SoundCloud set or track URL.');
  }
  if (parts.length !== 2) throw unsupported('Submit one SoundCloud track URL.');
  const [user, track] = parts;
  assertSegment(user);
  assertSegment(track);
  if (SOUNDCLOUD_RESERVED.has(user.toLowerCase())) throw unsupported('Submit one SoundCloud track URL.');
  const canonical = `https://soundcloud.com/${encodeURIComponent(user)}/${encodeURIComponent(track)}`;
  return { url: canonical, source: 'soundcloud', id: track, kind: 'video', short: false };
}

export function parseMediaUrl(input) {
  if (typeof input !== 'string') throw invalid();
  const text = input.trim();
  if (!text || text.length > 2048 || /[\u0000-\u001f\u007f\s\\]/.test(text)) throw invalid();
  let url;
  try {
    url = new URL(text);
  } catch {
    throw invalid();
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw invalid('Only http and https URLs are accepted.');
  if (url.username || url.password) throw invalid('URLs with embedded credentials are not accepted.');
  if (url.port) throw invalid('URLs with a custom port are not accepted.');
  const hostname = hostnameOf(url.hostname);
  const source = sourceFor(hostname);
  if (!source) throw unsupported();
  if (source === 'youtube') return parseYoutube(url, hostname);
  return parseSoundCloud(url, hostname);
}

function withTimeout(promise, ms, message) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new AppError('network', message, 502)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function resolvePublicAddresses(hostname, lookup, timeoutMs) {
  let records;
  try {
    records = await withTimeout(
      lookup(hostname, { all: true, verbatim: true }),
      timeoutMs,
      'Could not resolve that host.',
    );
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError('network', 'Could not resolve that host.', 502);
  }
  const list = Array.isArray(records) ? records : [records];
  if (!list.length) throw new AppError('network', 'Could not resolve that host.', 502);
  for (const record of list) {
    if (!record?.address || !isPublicAddress(record.address)) {
      throw new AppError('unsupported_url', 'That host does not resolve to a public address.', 400);
    }
  }
  return list.map((record) => ({ address: record.address, family: record.family || net.isIP(record.address) }));
}

export function requestHeaders(target, { address, family, timeoutMs = 5000 } = {}) {
  const url = typeof target === 'string' ? new URL(target) : target;
  const lib = url.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    const req = lib.request({
      host: address || url.hostname,
      family,
      servername: url.hostname,
      path: `${url.pathname}${url.search}`,
      method: 'GET',
      timeout: timeoutMs,
      agent: false,
      rejectUnauthorized: true,
      headers: {
        host: url.hostname,
        'user-agent': 'media-downloader/1.0',
        accept: '*/*',
        range: 'bytes=0-0',
        connection: 'close',
      },
    }, (res) => {
      res.resume();
      const location = res.headers.location;
      resolve({
        status: res.statusCode || 0,
        headers: { location: Array.isArray(location) ? location[0] : location || '' },
      });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.end();
  });
}

export function createValidation(deps = {}) {
  const lookup = deps.lookup || dns.promises.lookup;
  const request = deps.request || ((url, options) => requestHeaders(url, options));
  const timeoutMs = deps.timeoutMs || 5000;

  async function resolve(input) {
    let current = parseMediaUrl(input);
    const source = current.source;
    for (let hop = 0; hop < 5; hop += 1) {
      const target = new URL(current.url);
      const addresses = await resolvePublicAddresses(target.hostname, lookup, timeoutMs);
      const pinned = addresses[0];
      let response;
      try {
        response = await withTimeout(
          request(target, { address: pinned.address, family: pinned.family, timeoutMs }),
          timeoutMs + 500,
          'Could not reach that URL.',
        );
      } catch (error) {
        if (error instanceof AppError && error.code !== 'network') throw error;
        return { ...current, preflight: 'unreachable' };
      }
      if (!REDIRECT_STATUS.has(response.status)) {
        return { ...current, preflight: 'checked' };
      }
      if (!response.headers.location) throw invalid('The URL redirect was empty.');
      let nextUrl;
      try {
        nextUrl = new URL(response.headers.location, target).href;
      } catch {
        throw invalid('The URL redirect was invalid.');
      }
      const next = parseMediaUrl(nextUrl);
      if (next.source !== source) {
        throw unsupported('The URL redirected to an unsupported source.');
      }
      current = next;
    }
    throw new AppError('invalid_url', 'The URL redirected too many times.', 400);
  }

  return { resolve, parse: parseMediaUrl };
}
