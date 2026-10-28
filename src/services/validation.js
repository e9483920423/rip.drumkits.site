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
const SPOTIFY_HOSTS = new Set([
  'open.spotify.com',
  'play.spotify.com',
  'www.play.spotify.com',
  'spotify.com',
  'www.spotify.com',
  'spotify.link',
]);
const SPOTIFY_ID = /^[0-9A-Za-z]{22}$/;
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

const EXTRA_SITE_HOSTS = new Map();

function addHosts(source, hosts) {
  for (const host of hosts) EXTRA_SITE_HOSTS.set(host, source);
}

addHosts('vimeo', ['vimeo.com', 'www.vimeo.com', 'player.vimeo.com']);
addHosts('twitch', ['twitch.tv', 'www.twitch.tv', 'm.twitch.tv', 'clips.twitch.tv']);
addHosts('bilibili', ['bilibili.com', 'www.bilibili.com', 'm.bilibili.com', 'b23.tv', 'www.b23.tv']);
addHosts('reddit', ['reddit.com', 'www.reddit.com', 'old.reddit.com', 'm.reddit.com', 'v.redd.it', 'redd.it']);
addHosts('x', ['x.com', 'www.x.com', 'mobile.x.com', 'twitter.com', 'www.twitter.com', 'mobile.twitter.com']);
addHosts('facebook', ['facebook.com', 'www.facebook.com', 'm.facebook.com', 'web.facebook.com', 'fb.watch']);
addHosts('flickr', ['flickr.com', 'www.flickr.com', 'flic.kr']);
addHosts('peertube', ['peertube.tv', 'framatube.org', 'video.blender.org', 'tilvids.com', 'tube.tchncs.de']);
addHosts('dailymotion', ['dailymotion.com', 'www.dailymotion.com', 'dai.ly']);
addHosts('ted', ['ted.com', 'www.ted.com', 'embed.ted.com']);

function isBandcampHost(hostname) {
  return hostname === 'bandcamp.com' || hostname.endsWith('.bandcamp.com');
}

function sourceFor(hostname) {
  if (YOUTUBE_HOSTS.has(hostname)) return 'youtube';
  if (SOUNDCLOUD_HOSTS.has(hostname)) return 'soundcloud';
  if (SPOTIFY_HOSTS.has(hostname)) return 'spotify';
  if (isBandcampHost(hostname)) return 'bandcamp';
  return EXTRA_SITE_HOSTS.get(hostname) || '';
}

function invalid(message = 'Enter a valid media URL.') {
  return new AppError('invalid_url', message, 400);
}

function unsupported(message = 'This URL is not a supported media item.') {
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

function parseSpotify(url, hostname) {
  const spotifyUnsupported = 'Submit a Spotify track, album, or playlist URL.';
  if (hostname === 'spotify.link') {
    const parts = url.pathname.split('/').filter(Boolean).map(decodePart);
    if (parts.length !== 1 || !/^[A-Za-z0-9]+$/.test(parts[0])) {
      throw unsupported(spotifyUnsupported);
    }
    return {
      url: `https://spotify.link/${parts[0]}`,
      source: 'spotify',
      id: parts[0],
      kind: 'video',
      short: true,
    };
  }
  const parts = url.pathname.split('/').filter(Boolean).map(decodePart);
  if (parts[0] && /^intl-[a-z]{2}$/i.test(parts[0])) parts.shift();
  if ((parts[0] || '').toLowerCase() === 'embed') parts.shift();
  const type = (parts[0] || '').toLowerCase();
  const id = parts[1] || '';
  if (parts.length !== 2 || !SPOTIFY_ID.test(id)) {
    throw unsupported(spotifyUnsupported);
  }
  if (type === 'track') {
    return { url: `https://open.spotify.com/track/${id}`, source: 'spotify', id, kind: 'video' };
  }
  if (type === 'album' || type === 'playlist') {
    return { url: `https://open.spotify.com/${type}/${id}`, source: 'spotify', id, kind: 'playlist' };
  }
  throw unsupported(spotifyUnsupported);
}

const BLOCKED_PAGES = new Set([
  'login', 'signup', 'register', 'settings', 'account', 'oauth', 'authorize',
  'search', 'explore', 'directory', 'home', 'feed', 'messages', 'notifications',
  'premium', 'cart', 'checkout', 'manage', 'upload', 'live',
]);

function mediaItem(source, href, id, kind = 'video', extra = {}) {
  return { url: href, source, id: String(id).slice(0, 128), kind, ...extra };
}

function shortItem(source, host, id) {
  if (!/^[A-Za-z0-9_-]+$/.test(id)) throw unsupported();
  return mediaItem(source, `https://${host}/${id}`, id, 'video', { short: true });
}

function parseVimeo(url, hostname) {
  const parts = url.pathname.split('/').filter(Boolean).map(decodePart);
  if (hostname === 'player.vimeo.com') {
    if (parts.length !== 2 || parts[0].toLowerCase() !== 'video' || !/^\d+$/.test(parts[1])) {
      throw unsupported('Submit a Vimeo video URL.');
    }
    return mediaItem('vimeo', `https://vimeo.com/${parts[1]}`, parts[1]);
  }
  const head = (parts[0] || '').toLowerCase();
  if (BLOCKED_PAGES.has(head) || head === 'ondemand' || head === 'watch') {
    throw unsupported('Submit a Vimeo video or showcase URL.');
  }
  if (parts.length >= 1 && parts.length <= 2 && /^\d+$/.test(parts[0])) {
    const suffix = parts[1] && /^[A-Za-z0-9]+$/.test(parts[1]) ? `/${parts[1]}` : '';
    return mediaItem('vimeo', `https://vimeo.com/${parts[0]}${suffix}`, parts[0]);
  }
  if (parts.length === 2 && head === 'video' && /^\d+$/.test(parts[1])) {
    return mediaItem('vimeo', `https://vimeo.com/${parts[1]}`, parts[1]);
  }
  if (parts.length === 2 && (head === 'showcase' || head === 'album') && /^[A-Za-z0-9_-]+$/.test(parts[1])) {
    return mediaItem('vimeo', `https://vimeo.com/${head}/${parts[1]}`, parts[1], 'playlist');
  }
  if (parts.length === 3 && head === 'channels' && /^\d+$/.test(parts[2])) {
    assertSegment(parts[1]);
    return mediaItem('vimeo', `https://vimeo.com/${parts[2]}`, parts[2]);
  }
  throw unsupported('Submit a Vimeo video or showcase URL.');
}

function parseTwitch(url, hostname) {
  const parts = url.pathname.split('/').filter(Boolean).map(decodePart);
  if (hostname === 'clips.twitch.tv') {
    if (parts.length !== 1) throw unsupported('Submit a Twitch VOD or clip URL.');
    assertSegment(parts[0]);
    return mediaItem('twitch', `https://clips.twitch.tv/${parts[0]}`, parts[0]);
  }
  const head = (parts[0] || '').toLowerCase();
  if (!head || BLOCKED_PAGES.has(head) || ['p', 'downloads', 'inventory', 'subscriptions'].includes(head)) {
    throw unsupported('Submit a Twitch VOD or clip URL.');
  }
  if (head === 'videos' && parts.length === 2 && /^\d+$/.test(parts[1])) {
    return mediaItem('twitch', `https://www.twitch.tv/videos/${parts[1]}`, parts[1]);
  }
  if (parts.length === 3 && parts[1].toLowerCase() === 'clip') {
    assertSegment(parts[0]);
    assertSegment(parts[2]);
    return mediaItem('twitch', `https://www.twitch.tv/${encodeURIComponent(parts[0])}/clip/${encodeURIComponent(parts[2])}`, parts[2]);
  }
  if (parts.length === 3 && parts[1].toLowerCase() === 'video' && /^\d+$/.test(parts[2])) {
    return mediaItem('twitch', `https://www.twitch.tv/videos/${parts[2]}`, parts[2]);
  }
  throw unsupported('Submit a Twitch VOD or clip URL. Live channels are not supported.');
}

function parseBilibili(url, hostname) {
  const parts = url.pathname.split('/').filter(Boolean).map(decodePart);
  if (hostname === 'b23.tv' || hostname === 'www.b23.tv') {
    if (parts.length !== 1) throw unsupported('Submit a Bilibili video URL.');
    return shortItem('bilibili', 'b23.tv', parts[0]);
  }
  const head = (parts[0] || '').toLowerCase();
  if (BLOCKED_PAGES.has(head) || head === 'space' || head === 'festival') {
    throw unsupported('Submit a Bilibili video URL.');
  }
  if (head === 'video' && parts.length === 2 && /^(BV[0-9A-Za-z]+|av\d+)$/i.test(parts[1])) {
    return mediaItem('bilibili', `https://www.bilibili.com/video/${parts[1]}`, parts[1]);
  }
  if (head === 'bangumi' && parts.length === 3 && parts[1].toLowerCase() === 'play' && /^(ep|ss)\d+$/i.test(parts[2])) {
    return mediaItem('bilibili', `https://www.bilibili.com/bangumi/play/${parts[2]}`, parts[2]);
  }
  throw unsupported('Submit a Bilibili video URL.');
}

function parseReddit(url, hostname) {
  const parts = url.pathname.split('/').filter(Boolean).map(decodePart);
  if (hostname === 'v.redd.it' || hostname === 'redd.it') {
    if (parts.length !== 1) throw unsupported('Submit a Reddit video post URL.');
    return shortItem('reddit', hostname, parts[0]);
  }
  if (parts.length >= 4 && parts[0].toLowerCase() === 'r' && parts[2].toLowerCase() === 'comments') {
    assertSegment(parts[1]);
    assertSegment(parts[3]);
    const slug = parts[4] ? `/${encodeURIComponent(parts[4])}` : '';
    return mediaItem(
      'reddit',
      `https://www.reddit.com/r/${encodeURIComponent(parts[1])}/comments/${encodeURIComponent(parts[3])}${slug}`,
      parts[3],
    );
  }
  if (parts.length === 4 && parts[0].toLowerCase() === 'r' && parts[2].toLowerCase() === 's') {
    assertSegment(parts[1]);
    assertSegment(parts[3]);
    return mediaItem(
      'reddit',
      `https://www.reddit.com/r/${encodeURIComponent(parts[1])}/s/${encodeURIComponent(parts[3])}`,
      parts[3],
      'video',
      { short: true },
    );
  }
  throw unsupported('Submit a Reddit video post URL.');
}

function parseX(url) {
  const parts = url.pathname.split('/').filter(Boolean).map(decodePart);
  let statusId = '';
  if (parts.length === 3 && parts[1].toLowerCase() === 'status' && /^\d{5,20}$/.test(parts[2])) {
    assertSegment(parts[0]);
    statusId = parts[2];
  } else if (parts.length === 3 && parts[0].toLowerCase() === 'i' && parts[1].toLowerCase() === 'status' && /^\d{5,20}$/.test(parts[2])) {
    statusId = parts[2];
  } else if (parts.length === 4 && parts[0].toLowerCase() === 'i' && parts[1].toLowerCase() === 'web' && parts[2].toLowerCase() === 'status' && /^\d{5,20}$/.test(parts[3])) {
    statusId = parts[3];
  } else {
    throw unsupported('Submit a public X video post URL.');
  }
  return mediaItem('x', `https://x.com/i/status/${statusId}`, statusId);
}

function parseFacebook(url, hostname) {
  const parts = url.pathname.split('/').filter(Boolean).map(decodePart);
  if (hostname === 'fb.watch') {
    if (parts.length !== 1) throw unsupported('Submit a Facebook video URL.');
    return shortItem('facebook', 'fb.watch', parts[0]);
  }
  const head = (parts[0] || '').toLowerCase();
  if (BLOCKED_PAGES.has(head)) throw unsupported('Submit a Facebook video URL.');
  const watchId = url.searchParams.get('v') || '';
  if (head === 'watch' && /^\d+$/.test(watchId)) {
    return mediaItem('facebook', `https://www.facebook.com/watch/?v=${watchId}`, watchId);
  }
  if (head === 'watch' && parts.length === 2 && /^[A-Za-z0-9_-]+$/.test(parts[1])) {
    return mediaItem('facebook', `https://www.facebook.com/watch/${parts[1]}`, parts[1]);
  }
  if ((head === 'reel' || head === 'reels') && parts.length === 2 && /^[A-Za-z0-9_-]+$/.test(parts[1])) {
    return mediaItem('facebook', `https://www.facebook.com/reel/${parts[1]}`, parts[1]);
  }
  if (parts.length === 3 && parts[1].toLowerCase() === 'videos' && /^[A-Za-z0-9_-]+$/.test(parts[2])) {
    assertSegment(parts[0]);
    return mediaItem(
      'facebook',
      `https://www.facebook.com/${encodeURIComponent(parts[0])}/videos/${parts[2]}`,
      parts[2],
    );
  }
  throw unsupported('Submit a Facebook video URL.');
}

function parseFlickr(url, hostname) {
  const parts = url.pathname.split('/').filter(Boolean).map(decodePart);
  if (hostname === 'flic.kr') {
    if (parts.length !== 2 || !['p', 's'].includes(parts[0].toLowerCase())) {
      throw unsupported('Submit a Flickr video URL.');
    }
    assertSegment(parts[1]);
    return mediaItem('flickr', `https://flic.kr/${parts[0]}/${parts[1]}`, parts[1], 'video', { short: true });
  }
  if (parts[0]?.toLowerCase() !== 'photos' || parts.length < 3) {
    throw unsupported('Submit a Flickr video URL.');
  }
  assertSegment(parts[1]);
  const third = (parts[2] || '').toLowerCase();
  if ((third === 'sets' || third === 'albums') && parts.length === 4 && /^[A-Za-z0-9_-]+$/.test(parts[3])) {
    return mediaItem(
      'flickr',
      `https://www.flickr.com/photos/${encodeURIComponent(parts[1])}/${third}/${parts[3]}`,
      parts[3],
      'playlist',
    );
  }
  if (!/^\d+$/.test(parts[2])) throw unsupported('Submit a Flickr video URL.');
  return mediaItem(
    'flickr',
    `https://www.flickr.com/photos/${encodeURIComponent(parts[1])}/${parts[2]}`,
    parts[2],
  );
}

function parsePeertube(url, hostname) {
  const parts = url.pathname.split('/').filter(Boolean).map(decodePart);
  const head = (parts[0] || '').toLowerCase();
  if (BLOCKED_PAGES.has(head) || ['c', 'a', 'accounts', 'video-channels'].includes(head)) {
    throw unsupported('Submit a PeerTube video or playlist URL.');
  }
  if (head === 'w' && parts.length === 2) {
    assertSegment(parts[1]);
    return mediaItem('peertube', `https://${hostname}/w/${parts[1]}`, parts[1]);
  }
  if (head === 'w' && parts.length === 3 && parts[1].toLowerCase() === 'p') {
    assertSegment(parts[2]);
    return mediaItem('peertube', `https://${hostname}/w/p/${parts[2]}`, parts[2], 'playlist');
  }
  if (head === 'videos' && parts.length === 3 && parts[1].toLowerCase() === 'watch') {
    assertSegment(parts[2]);
    return mediaItem('peertube', `https://${hostname}/videos/watch/${parts[2]}`, parts[2]);
  }
  if (head === 'videos' && parts.length === 4 && parts[1].toLowerCase() === 'watch' && parts[2].toLowerCase() === 'playlist') {
    assertSegment(parts[3]);
    return mediaItem('peertube', `https://${hostname}/videos/watch/playlist/${parts[3]}`, parts[3], 'playlist');
  }
  throw unsupported('Submit a PeerTube video or playlist URL.');
}

function parseDailymotion(url, hostname) {
  const parts = url.pathname.split('/').filter(Boolean).map(decodePart);
  if (hostname === 'dai.ly') {
    if (parts.length !== 1) throw unsupported('Submit a Dailymotion video URL.');
    return shortItem('dailymotion', 'dai.ly', parts[0]);
  }
  const head = (parts[0] || '').toLowerCase();
  if (head === 'video' && parts.length === 2) {
    assertSegment(parts[1]);
    return mediaItem('dailymotion', `https://www.dailymotion.com/video/${parts[1]}`, parts[1]);
  }
  if (head === 'playlist' && parts.length === 2) {
    assertSegment(parts[1]);
    return mediaItem('dailymotion', `https://www.dailymotion.com/playlist/${parts[1]}`, parts[1], 'playlist');
  }
  throw unsupported('Submit a Dailymotion video or playlist URL.');
}

const BANDCAMP_RESERVED_SUBS = new Set([
  'www', 'daily', 'support', 'help', 'video', 'blog', 'instagram', 'merch', 'shop', 'community',
]);

function parseBandcamp(url, hostname) {
  const labels = hostname.split('.');
  const artist = labels[0] || '';
  if (labels.length !== 3 || BANDCAMP_RESERVED_SUBS.has(artist)) {
    throw unsupported('Submit a Bandcamp album or track URL.');
  }
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(artist)) {
    throw unsupported('Submit a Bandcamp album or track URL.');
  }
  const parts = url.pathname.split('/').filter(Boolean).map(decodePart);
  const head = (parts[0] || '').toLowerCase();
  if (parts.length !== 2 || (head !== 'album' && head !== 'track')) {
    throw unsupported('Submit a Bandcamp album or track URL.');
  }
  assertSegment(parts[1]);
  return mediaItem(
    'bandcamp',
    `https://${artist}.bandcamp.com/${head}/${encodeURIComponent(parts[1])}`,
    parts[1],
    head === 'album' ? 'playlist' : 'video',
  );
}

function parseTed(url, hostname) {
  const parts = url.pathname.split('/').filter(Boolean).map(decodePart);
  const head = (parts[0] || '').toLowerCase();
  if (head === 'talks' && parts.length === 2) {
    assertSegment(parts[1]);
    return mediaItem('ted', `https://www.ted.com/talks/${encodeURIComponent(parts[1])}`, parts[1]);
  }
  if (head === 'playlists' && parts.length >= 2 && /^\d+$/.test(parts[1])) {
    const slug = parts[2] ? `/${encodeURIComponent(parts[2])}` : '';
    return mediaItem('ted', `https://www.ted.com/playlists/${parts[1]}${slug}`, parts[1], 'playlist');
  }
  if (hostname === 'embed.ted.com' && head === 'talks' && parts.length === 2) {
    assertSegment(parts[1]);
    return mediaItem('ted', `https://www.ted.com/talks/${encodeURIComponent(parts[1])}`, parts[1]);
  }
  throw unsupported('Submit a TED talk or playlist URL.');
}

const EXTRA_PARSERS = {
  vimeo: parseVimeo,
  twitch: parseTwitch,
  bilibili: parseBilibili,
  reddit: parseReddit,
  x: parseX,
  facebook: parseFacebook,
  flickr: parseFlickr,
  peertube: parsePeertube,
  dailymotion: parseDailymotion,
  ted: parseTed,
  bandcamp: parseBandcamp,
};

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
  if (source === 'soundcloud') return parseSoundCloud(url, hostname);
  if (source === 'spotify') return parseSpotify(url, hostname);
  const extra = EXTRA_PARSERS[source];
  if (!extra) throw unsupported();
  return extra(url, hostname);
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
