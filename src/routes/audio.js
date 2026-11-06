import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { AppError } from '../errors.js';
import { convertFile, getConvertFormat, inputExtension } from '../services/convert.js';
import { contentDisposition, sanitizeFilename } from '../services/storage.js';

function fieldValue(part) {
  if (part == null) return '';
  if (typeof part.value === 'string') return part.value;
  if (typeof part === 'string') return part;
  return '';
}

export function registerAudioRoutes(app, ctx) {
  const maxBytes = ctx.config.maxFileSizeMb * 1024 * 1024;

  app.post('/api/audio/convert', { bodyLimit: maxBytes }, async (request, reply) => {
    if (!ctx.tools.ffmpeg) {
      throw new AppError('tools_missing', 'FFmpeg is not available on this server.', 503);
    }

    const id = randomUUID();
    if (!ctx.streams.begin(id)) {
      throw new AppError('queue_full', 'A download is already running. Wait for it to finish.', 429);
    }

    const controller = new AbortController();
    const abort = () => controller.abort();
    request.raw.on('aborted', abort);

    let formatId = '';
    let inputPath = '';
    let originalName = 'audio';
    let sent = false;
    try {
      ctx.storage.assertFreeDisk(ctx.config.maxFileSizeMb);
      const workDir = ctx.storage.createWorkDir(id);
      for await (const part of request.parts({ limits: { files: 1, fields: 8, fileSize: maxBytes } })) {
        if (part.file) {
          if (inputPath) {
            part.file.resume();
            throw new AppError('bad_request', 'Send one audio file.', 400);
          }
          const ext = inputExtension(part.filename);
          originalName = part.filename || 'audio';
          inputPath = path.join(workDir, `input.${ext}`);
          await pipeline(part.file, fs.createWriteStream(inputPath));
          if (part.file.truncated) {
            throw new AppError('too_large', 'The file is larger than the configured limit.', 413);
          }
        } else if (part.fieldname === 'format') {
          formatId = String(fieldValue(part) || '').trim().toLowerCase();
        }
      }

      const spec = getConvertFormat(formatId);
      if (!inputPath) throw new AppError('bad_request', 'Send an audio file.', 400);

      const outputPath = path.join(workDir, `output.${spec.ext}`);
      const result = await convertFile({
        runProcess: ctx.runProcess,
        ffmpegPath: ctx.config.ffmpegPath,
        inputPath,
        outputPath,
        format: formatId,
        signal: controller.signal,
        timeoutMs: ctx.config.jobTimeoutSeconds * 1000,
        maxBytes,
      });

      const title = sanitizeFilename(path.basename(originalName, path.extname(originalName)));
      const stream = fs.createReadStream(outputPath);
      sent = true;
      const cleanup = () => {
        try {
          ctx.storage.removeWorkDir(id);
        } catch {
          // Temp cleanup also runs on a timer.
        }
      };
      stream.on('close', cleanup);
      reply.raw.once('finish', cleanup);
      return reply
        .header('content-disposition', contentDisposition(`${title}.${result.ext}`))
        .header('cache-control', 'no-store')
        .type('application/octet-stream')
        .send(stream);
    } catch (error) {
      if (!sent) {
        try {
          ctx.storage.removeWorkDir(id);
        } catch {
          // The work dir may not have been created.
        }
      }
      throw error;
    } finally {
      request.raw.off('aborted', abort);
      ctx.streams.end(id);
    }
  });
}
