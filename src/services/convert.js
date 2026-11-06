import fs from 'node:fs';
import path from 'node:path';
import { AppError } from '../errors.js';

export const CONVERT_FORMATS = {
  mp3: { ext: 'mp3', args: ['-codec:a', 'libmp3lame', '-q:a', '2'] },
  m4a: { ext: 'm4a', args: ['-codec:a', 'aac', '-b:a', '192k'] },
  opus: { ext: 'opus', args: ['-codec:a', 'libopus', '-b:a', '128k'] },
  flac: { ext: 'flac', args: ['-codec:a', 'flac'] },
  wav: { ext: 'wav', args: ['-codec:a', 'pcm_s16le'] },
};

export const INPUT_EXTS = new Set(['wav', 'mp3', 'm4a', 'aac', 'flac', 'ogg', 'opus', 'webm', 'aiff', 'aif', 'mp4']);

export function getConvertFormat(id) {
  const spec = CONVERT_FORMATS[id];
  if (!spec) throw new AppError('bad_request', 'Pick mp3, m4a, opus, flac, or wav.', 400);
  return spec;
}

export function inputExtension(filename) {
  const ext = path.extname(String(filename || '')).slice(1).toLowerCase();
  if (!INPUT_EXTS.has(ext)) throw new AppError('bad_request', 'Drop a wav, mp3, m4a, flac, ogg, or opus file.', 400);
  return ext;
}

export function buildConvertArgs(inputPath, outputPath, formatId) {
  const spec = getConvertFormat(formatId);
  return [
    '-y',
    '-hide_banner',
    '-nostdin',
    '-i',
    inputPath,
    '-vn',
    ...spec.args,
    outputPath,
  ];
}

function headerLooksLike(ext, header) {
  if (header.length < 12) return false;
  if (ext === 'wav') {
    return header.subarray(0, 4).toString('ascii') === 'RIFF' && header.subarray(8, 12).toString('ascii') === 'WAVE';
  }
  if (ext === 'mp4' || ext === 'm4a') {
    return header.length >= 8 && header.subarray(4, 8).toString('ascii') === 'ftyp';
  }
  if (ext === 'mp3') {
    if (header.subarray(0, 3).toString('ascii') === 'ID3') return true;
    return header[0] === 0xff && (header[1] & 0xe0) === 0xe0;
  }
  if (ext === 'ogg' || ext === 'opus') return header.subarray(0, 4).toString('ascii') === 'OggS';
  if (ext === 'flac') return header.subarray(0, 4).toString('ascii') === 'fLaC';
  return false;
}

export function verifyConvertedFile(filePath, ext, maxBytes) {
  let stat;
  try {
    stat = fs.statSync(filePath);
  } catch {
    throw new AppError('convert_failed', 'The conversion finished without a file.', 422);
  }
  if (!stat.isFile() || stat.size <= 0) {
    throw new AppError('convert_failed', 'The conversion finished without a file.', 422);
  }
  if (stat.size > maxBytes) {
    throw new AppError('too_large', 'The file is larger than the configured limit.', 413);
  }
  const handle = fs.openSync(filePath, 'r');
  let header;
  try {
    const buffer = Buffer.alloc(32);
    const bytes = fs.readSync(handle, buffer, 0, 32, 0);
    header = buffer.subarray(0, bytes);
  } finally {
    fs.closeSync(handle);
  }
  if (!headerLooksLike(ext, header)) {
    throw new AppError('convert_failed', 'The conversion finished without a valid audio file.', 422);
  }
  return { bytes: stat.size, ext };
}

export async function convertFile({ runProcess, ffmpegPath, inputPath, outputPath, format, signal, timeoutMs, maxBytes }) {
  const args = buildConvertArgs(inputPath, outputPath, format);
  const result = await runProcess(ffmpegPath, args, { timeoutMs, signal, stdoutCap: 64_000 });
  if (result.cancelled) throw new AppError('cancelled', 'The conversion was cancelled.', 499);
  if (result.timedOut) throw new AppError('timeout', 'The conversion timed out.', 504);
  if (result.code !== 0) {
    throw new AppError('convert_failed', 'The conversion failed.', 422);
  }
  return verifyConvertedFile(outputPath, CONVERT_FORMATS[format].ext, maxBytes);
}
