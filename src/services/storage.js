import fs from 'node:fs';
import path from 'node:path';
import { AppError } from '../errors.js';

const JOB_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ALLOWED_EXT = new Set(['mp3', 'm4a', 'mp4', 'webm', 'mkv', 'ogg', 'opus', 'flac']);

export function assertJobId(id) {
  if (typeof id !== 'string' || !JOB_ID.test(id)) {
    throw new AppError('invalid_id', 'Job id is invalid.', 400);
  }
  return id;
}

export function isInside(parent, target) {
  const base = path.resolve(parent);
  const full = path.resolve(target);
  const rel = path.relative(base, full);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

export function sanitizeFilename(name) {
  const cleaned = String(name ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[<>:"/\\|?*]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '')
    .slice(0, 80);
  return cleaned || 'download';
}

function readHeader(filePath) {
  const handle = fs.openSync(filePath, 'r');
  try {
    const buffer = Buffer.alloc(32);
    const bytes = fs.readSync(handle, buffer, 0, 32, 0);
    return buffer.subarray(0, bytes);
  } finally {
    fs.closeSync(handle);
  }
}

function hasSignature(ext, header) {
  if (header.length < 4) return false;
  if (ext === 'mp4' || ext === 'm4a') {
    return header.length >= 8 && header.subarray(4, 8).toString('ascii') === 'ftyp';
  }
  if (ext === 'mp3') {
    if (header.subarray(0, 3).toString('ascii') === 'ID3') return true;
    return header[0] === 0xff && (header[1] & 0xe0) === 0xe0;
  }
  if (ext === 'ogg' || ext === 'opus') return header.subarray(0, 4).toString('ascii') === 'OggS';
  if (ext === 'flac') return header.subarray(0, 4).toString('ascii') === 'fLaC';
  if (ext === 'webm' || ext === 'mkv') {
    return header[0] === 0x1a && header[1] === 0x45 && header[2] === 0xdf && header[3] === 0xa3;
  }
  return false;
}

export function verifyMediaFile(filePath, maxBytes) {
  let stat;
  try {
    stat = fs.statSync(filePath);
  } catch {
    throw new AppError('invalid_output', 'The download finished without a valid file.', 422);
  }
  if (!stat.isFile() || stat.size <= 0) {
    throw new AppError('invalid_output', 'The download finished without a valid file.', 422);
  }
  if (stat.size > maxBytes) {
    throw new AppError('too_large', 'The file is larger than the configured limit.', 413);
  }
  const ext = path.extname(filePath).slice(1).toLowerCase();
  if (!ALLOWED_EXT.has(ext) || !hasSignature(ext, readHeader(filePath))) {
    throw new AppError('invalid_output', 'The download finished without a valid media file.', 422);
  }
  return { bytes: stat.size, ext };
}

export function createStorage(config) {
  function ensureDirs() {
    for (const dir of [config.dataDir, config.tmpDir]) {
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    }
  }

  function workDir(jobId) {
    assertJobId(jobId);
    const dir = path.resolve(config.tmpDir, jobId);
    if (!isInside(config.tmpDir, dir)) {
      throw new AppError('invalid_path', 'Job path is invalid.', 400);
    }
    return dir;
  }

  function createWorkDir(jobId) {
    const dir = workDir(jobId);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    return dir;
  }

  function removeWorkDir(jobId) {
    const dir = workDir(jobId);
    fs.rmSync(dir, { recursive: true, force: true });
  }

  function cleanupTemps(activeIds = [], now = Date.now()) {
    const active = new Set(activeIds);
    const tempCutoff = now - (config.tempRetentionHours * 60 * 60 * 1000);
    const removed = [];
    if (!fs.existsSync(config.tmpDir)) return removed;
    for (const name of fs.readdirSync(config.tmpDir)) {
      if (!JOB_ID.test(name) || active.has(name)) continue;
      const dir = path.resolve(config.tmpDir, name);
      if (!isInside(config.tmpDir, dir)) continue;
      let stat;
      try {
        stat = fs.statSync(dir);
      } catch {
        continue;
      }
      if (!stat.isDirectory() || stat.mtimeMs > tempCutoff) continue;
      fs.rmSync(dir, { recursive: true, force: true });
      removed.push(name);
    }
    return removed;
  }

  return {
    ensureDirs,
    createWorkDir,
    removeWorkDir,
    workDir,
    cleanupTemps,
  };
}

export function contentDisposition(filename) {
  const safe = sanitizeFilename(filename).replace(/[\r\n"]/g, '');
  return `attachment; filename="${safe}"; filename*=UTF-8''${encodeURIComponent(safe)}`;
}

export function mimeType(ext) {
  switch (ext) {
    case 'mp3': return 'audio/mpeg';
    case 'm4a': return 'audio/mp4';
    case 'mp4': return 'video/mp4';
    case 'webm': return 'video/webm';
    case 'mkv': return 'video/x-matroska';
    case 'ogg': return 'audio/ogg';
    case 'opus': return 'audio/opus';
    case 'flac': return 'audio/flac';
    default: return 'application/octet-stream';
  }
}
