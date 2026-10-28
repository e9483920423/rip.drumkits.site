import { AppError } from '../errors.js';
import { formatsFor, getFormat, publicFormat } from '../services/media.js';
import { assertJobId, contentDisposition, sanitizeFilename } from '../services/storage.js';

const STREAM_HEADERS = {
  'content-security-policy': "default-src 'self'; img-src 'self' https://i.ytimg.com https://*.sndcdn.com https://i.scdn.co https://mosaic.scdn.co https://*.vimeocdn.com https://*.jtvnw.net https://*.hdslb.com https://*.redd.it https://*.redditmedia.com https://pbs.twimg.com https://*.fbcdn.net https://*.staticflickr.com https://*.dmcdn.net https://*.tedcdn.com https://images.ted.com https://*.bcbits.com; style-src 'self'; script-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; object-src 'none'",
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'x-frame-options': 'DENY',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
  'cross-origin-resource-policy': 'same-origin',
  'cache-control': 'no-store',
};

function jsonError(reply, error) {
  const status = error instanceof AppError ? error.status : 500;
  const code = error instanceof AppError ? error.code : 'internal';
  const message = error instanceof AppError ? error.message : 'Something went wrong.';
  if (!reply.raw.headersSent) {
    reply.raw.writeHead(status, { ...STREAM_HEADERS, 'content-type': 'application/json; charset=utf-8' });
  }
  if (!reply.raw.writableEnded) {
    reply.raw.end(JSON.stringify({ error: { code, message } }));
  }
}

function startAttachment(reply, filename, size) {
  reply.raw.removeHeader('x-frame-options');
  const headers = {
    'content-type': 'application/octet-stream',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    'cache-control': 'no-store',
    'cross-origin-resource-policy': 'same-origin',
    'content-disposition': contentDisposition(filename),
  };
  if (Number.isFinite(size) && size > 0) {
    headers['content-length'] = String(Math.floor(size));
  }
  reply.raw.writeHead(200, headers);
}

function requireSourceTools(tools, source, { download } = {}) {
  if (source === 'spotify') {
    if (!tools.spotdl) {
      throw new AppError('tools_missing', 'spotDL is not available on this server.', 503);
    }
  } else if (!tools.ytdlp) {
    throw new AppError('tools_missing', 'yt-dlp is not available on this server.', 503);
  }
  if (download && !tools.ffmpeg) {
    throw new AppError('tools_missing', 'FFmpeg is not available on this server.', 503);
  }
}

function readItems(raw, source, max, parse) {
  if (raw == null) return null;
  if (!Array.isArray(raw)) throw new AppError('bad_request', 'items must be an array.', 400);
  if (!raw.length) return null;
  if (raw.length > max) {
    throw new AppError('too_many', `Select at most ${max} tracks.`, 400);
  }
  const items = [];
  const seen = new Set();
  for (const row of raw) {
    if (!row || typeof row !== 'object') {
      throw new AppError('bad_request', 'Each selected item needs a URL.', 400);
    }
    if (typeof row.url !== 'string' || row.url.length > 2048) {
      throw new AppError('bad_request', 'Each selected item needs a URL.', 400);
    }
    const parsed = parse(row.url);
    if (parsed.source !== source) {
      throw new AppError('unsupported_url', 'Every selected item must be from the same site.', 400);
    }
    if (parsed.kind === 'playlist') {
      throw new AppError('unsupported_url', 'Select individual tracks, not a playlist URL.', 400);
    }
    if (seen.has(parsed.url)) continue;
    seen.add(parsed.url);
    items.push({
      url: parsed.url,
      title: typeof row.title === 'string' ? sanitizeFilename(row.title) : 'track',
    });
  }
  return items.length ? items : null;
}

export function registerMediaRoutes(app, ctx) {
  app.post('/api/media/info', async (request) => {
    const raw = request.body?.url;
    if (typeof raw !== 'string' || raw.length > 2048) {
      throw new AppError('invalid_url', 'Enter a supported media URL.', 400);
    }
    const parsed = ctx.validation.parse(raw);
    requireSourceTools(ctx.tools, parsed.source);
    const resolved = await ctx.validation.resolve(raw);
    const controller = new AbortController();
    const abort = () => controller.abort();
    request.raw.on('aborted', abort);
    try {
      const info = await ctx.media.inspect(resolved.url, resolved.source, controller.signal, {
        kind: resolved.kind === 'playlist' ? 'playlist' : 'video',
      });
      return {
        source: resolved.source,
        url: resolved.url,
        kind: info.kind || 'video',
        title: info.title,
        uploader: info.uploader,
        durationSeconds: info.durationSeconds,
        thumbnailUrl: info.thumbnailUrl,
        truncated: Boolean(info.truncated),
        entries: Array.isArray(info.entries) ? info.entries : [],
        maxZipItems: ctx.config.maxZipItems,
        formats: formatsFor(resolved.source).map(publicFormat),
      };
    } finally {
      request.raw.off('aborted', abort);
    }
  });

  app.post('/api/media/download', async (request) => {
    const rawUrl = request.body?.url;
    const format = request.body?.format;
    const title = request.body?.title;
    if (typeof rawUrl !== 'string' || rawUrl.length > 2048 || typeof format !== 'string' || format.length > 32) {
      throw new AppError('bad_request', 'Send a URL and a format.', 400);
    }
    const parsed = ctx.validation.parse(rawUrl);
    getFormat(parsed.source, format);
    requireSourceTools(ctx.tools, parsed.source, { download: true });
    const items = readItems(request.body?.items, parsed.source, ctx.config.maxZipItems, ctx.validation.parse);
    if (parsed.kind === 'playlist' && !items) {
      throw new AppError('bad_request', 'Select one or more tracks from this playlist.', 400);
    }

    let ticket;
    if (items?.length === 1) {
      const resolved = await ctx.validation.resolve(items[0].url);
      ticket = ctx.streams.issue({
        mode: 'file',
        url: resolved.url,
        source: resolved.source,
        format,
        title: items[0].title || (typeof title === 'string' ? sanitizeFilename(title) : 'download'),
      });
    } else if (items?.length >= 2) {
      ticket = ctx.streams.issue({
        mode: 'zip',
        source: parsed.source,
        format,
        title: typeof title === 'string' ? sanitizeFilename(title) : 'playlist',
        items,
      });
    } else {
      const resolved = await ctx.validation.resolve(rawUrl);
      ticket = ctx.streams.issue({
        mode: 'file',
        url: resolved.url,
        source: resolved.source,
        format,
        title: typeof title === 'string' ? sanitizeFilename(title) : 'download',
      });
    }
    return { ticket };
  });

  app.get('/api/media/download/:ticket', async (request, reply) => {
    const id = assertJobId(request.params.ticket);
    const ticket = ctx.streams.consume(id);
    if (!ticket) throw new AppError('not_found', 'That download is not available.', 404);
    if (!ctx.streams.begin(id)) {
      ctx.streams.restore(ticket);
      throw new AppError('queue_full', 'A download is already running. Wait for it to finish.', 429);
    }

    const format = getFormat(ticket.source, ticket.format);
    const filename = ticket.mode === 'zip'
      ? `${ticket.title || 'playlist'}.zip`
      : `${ticket.title || 'download'}.${format.ext}`;
    const controller = new AbortController();
    const abort = () => controller.abort();
    request.raw.on('aborted', abort);

    reply.hijack();
    let started = false;
    let expectedBytes = 0;
    try {
      ctx.storage.assertFreeDisk(ticket.mode === 'zip' ? ctx.config.maxZipSizeMb : ctx.config.maxFileSizeMb);
      ctx.storage.createWorkDir(id);
      const hooks = {
        onReady({ bytes } = {}) {
          if (Number.isFinite(bytes) && bytes > 0) expectedBytes = bytes;
        },
        onFirstByte(chunk) {
          started = true;
          startAttachment(reply, filename, expectedBytes);
          reply.raw.write(chunk);
        },
        write(chunk) {
          reply.raw.write(chunk);
        },
      };
      if (ticket.mode === 'zip') {
        await ctx.media.zip({
          items: ticket.items,
          source: ticket.source,
          format: ticket.format,
          workDir: ctx.storage.workDir(id),
          signal: controller.signal,
          ...hooks,
        });
      } else {
        await ctx.media.stream({
          url: ticket.url,
          source: ticket.source,
          format: ticket.format,
          workDir: ctx.storage.workDir(id),
          signal: controller.signal,
          ...hooks,
        });
      }
      if (!started) {
        jsonError(reply, new AppError('download_failed', 'The download failed.', 422));
        return;
      }
      if (!reply.raw.writableEnded) reply.raw.end();
    } catch (error) {
      ctx.log?.error('stream failed', {
        ticket: id,
        code: error?.code,
        message: error instanceof Error ? error.message : 'unknown',
        detail: typeof error?.detail === 'string' ? error.detail : undefined,
      });
      if (started) {
        try {
          reply.raw.destroy();
        } catch {
          // The client may already be gone.
        }
      } else {
        jsonError(reply, error instanceof AppError ? error : new AppError('internal', 'Something went wrong.', 500));
      }
    } finally {
      request.raw.off('aborted', abort);
      ctx.streams.end(id);
      ctx.storage.removeWorkDir(id);
    }
  });
}
