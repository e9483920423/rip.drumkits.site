import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import Fastify from 'fastify';
import { accessTokenRequired, isLoopbackHost, loadConfig } from './config.js';
import { AppError } from './errors.js';
import { createLogger } from './logger.js';
import { registerMediaRoutes } from './routes/media.js';
import { createMediaService } from './services/media.js';
import { accessTokenMatches, readAccessToken } from './services/access-token.js';
import { createRateLimiter, limitForPath } from './services/rate-limit.js';
import { createStorage, isInside } from './services/storage.js';
import { createStreamManager } from './services/streams.js';
import { createValidation } from './services/validation.js';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const publicDir = path.join(rootDir, 'public');

const SECURITY_HEADERS = {
  'content-security-policy': "default-src 'self'; img-src 'self' https://i.ytimg.com https://*.sndcdn.com https://i.scdn.co https://mosaic.scdn.co https://*.vimeocdn.com https://*.jtvnw.net https://*.hdslb.com https://*.redd.it https://*.redditmedia.com https://pbs.twimg.com https://*.fbcdn.net https://*.staticflickr.com https://*.dmcdn.net https://*.tedcdn.com https://images.ted.com https://*.bcbits.com; style-src 'self'; script-src 'self'; font-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; object-src 'none'",
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'x-frame-options': 'DENY',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
  'cross-origin-resource-policy': 'same-origin',
  'x-dns-prefetch-control': 'off',
};

function sendPublic(reply, name, type) {
  const full = path.resolve(publicDir, name);
  if (!isInside(publicDir, full) || !fs.existsSync(full)) {
    return reply.code(404).type('text/plain').send('Not found');
  }
  return reply.type(type).header('cache-control', 'no-cache').send(fs.createReadStream(full));
}

export async function createApp(options = {}) {
  const config = options.config || loadConfig(process.env, options.cwd || process.cwd());
  const log = options.log || createLogger(config.logLevel);
  const storage = createStorage(config);
  storage.ensureDirs();
  const validation = options.validation || createValidation({
    lookup: options.lookup,
    request: options.request,
  });
  const media = options.media || createMediaService(config, {
    runProcess: options.runProcess,
    streamProcess: options.streamProcess,
  });
  const streams = options.streams || createStreamManager({
    maxConcurrent: config.maxConcurrentJobs,
    now: options.now,
  });
  const tools = options.tools || await media.probe();
  if (!tools.ytdlp || !tools.ffmpeg || !tools.spotdl) {
    log.warn('media tools unavailable', {
      ytdlp: Boolean(tools.ytdlp),
      ffmpeg: Boolean(tools.ffmpeg),
      spotdl: Boolean(tools.spotdl),
    });
  }
  const tokenRequired = accessTokenRequired(config);
  if (!isLoopbackHost(config.host) && !config.accessToken) {
    log.warn('public bind has no ACCESS_TOKEN; anyone who can reach the host can start downloads');
  }

  const app = Fastify({
    logger: config.logLevel === 'silent' ? false : { level: config.logLevel },
    bodyLimit: config.bodyLimitBytes,
    trustProxy: false,
    requestTimeout: (config.jobTimeoutSeconds + 60) * 1000,
  });
  const limits = {
    general: createRateLimiter({
      limit: config.rateLimitPerMinute,
      windowMs: 60_000,
      now: options.now,
    }),
    inspect: createRateLimiter({
      limit: config.rateLimitInspectPerMinute,
      windowMs: 60_000,
      now: options.now,
    }),
    download: createRateLimiter({
      limit: config.rateLimitDownloadPerMinute,
      windowMs: 60_000,
      now: options.now,
    }),
  };

  app.addHook('onRequest', async (request, reply) => {
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) reply.header(name, value);
    if (!request.url.startsWith('/api/')) return;
    const pathname = String(request.url).split('?')[0];
    const bucket = limits[limitForPath(pathname)] || limits.general;
    if (!bucket(request.ip || 'local')) {
      reply.header('retry-after', '60');
      throw new AppError('rate_limited', 'Too many requests. Try again in a minute.', 429);
    }
  });

  app.addHook('preHandler', async (request) => {
    if (!request.url.startsWith('/api/')) return;
    const changing = !['GET', 'HEAD', 'OPTIONS'].includes(request.method);
    if (changing && request.headers['x-media-request'] !== '1') {
      throw new AppError('forbidden', 'This request was rejected.', 403);
    }
    if (!tokenRequired || request.method === 'GET' || request.method === 'HEAD' || request.method === 'OPTIONS') {
      return;
    }
    if (!accessTokenMatches(readAccessToken(request), config.accessToken)) {
      throw new AppError('unauthorized', 'This server requires an access token.', 401);
    }
  });

  app.addHook('onSend', async (request, reply, payload) => {
    if (request.url.startsWith('/api/') && !reply.getHeader('content-disposition')) {
      reply.header('cache-control', 'no-store');
    }
    return payload;
  });

  app.setErrorHandler((error, request, reply) => {
    if (reply.raw.headersSent) return;
    if (error instanceof AppError) {
      if (error.status >= 500) request.log.error({ err: error }, 'request failed');
      return reply.code(error.status).send({ error: { code: error.code, message: error.message } });
    }
    const status = error.statusCode || 500;
    if (status === 413) {
      return reply.code(413).send({ error: { code: 'too_large', message: 'The request is too large.' } });
    }
    if (status === 415) {
      return reply.code(415).send({ error: { code: 'unsupported_media', message: 'Send JSON.' } });
    }
    if (status < 500) {
      return reply.code(status).send({ error: { code: 'bad_request', message: 'Invalid request.' } });
    }
    request.log.error({ err: error }, 'request failed');
    return reply.code(500).send({ error: { code: 'internal', message: 'Something went wrong.' } });
  });

  app.setNotFoundHandler((request, reply) => {
    if (request.url.startsWith('/api/')) {
      return reply.code(404).send({ error: { code: 'not_found', message: 'Not found.' } });
    }
    return reply.code(404).type('text/plain').send('Not found');
  });

  app.get('/api/health', async () => ({
    ok: true,
    tools: {
      ytdlp: Boolean(tools.ytdlp),
      ffmpeg: Boolean(tools.ffmpeg),
      spotdl: Boolean(tools.spotdl),
    },
    auth: { required: tokenRequired },
  }));

  const ctx = { app, config, storage, streams, media, validation, tools, log };
  registerMediaRoutes(app, ctx);

  app.get('/', async (request, reply) => sendPublic(reply, 'index.html', 'text/html; charset=utf-8'));
  app.get('/styles.css', async (request, reply) => sendPublic(reply, 'styles.css', 'text/css; charset=utf-8'));
  app.get('/app.js', async (request, reply) => sendPublic(reply, 'app.js', 'text/javascript; charset=utf-8'));
  app.get('/fonts/:file', async (request, reply) => {
    const file = String(request.params.file || '');
    if (!/^JetBrainsMono-(Regular|SemiBold|Bold)\.woff2$/.test(file)) {
      return reply.code(404).type('text/plain').send('Not found');
    }
    return sendPublic(reply, path.join('fonts', file), 'font/woff2');
  });
  app.get('/favicon.ico', async (request, reply) => reply.code(204).send());

  let timer = null;
  if (config.cleanupIntervalMinutes) {
    timer = setInterval(() => {
      try {
        storage.cleanupTemps(streams.activeIds());
      } catch (error) {
        log.error('cleanup failed', { error: error.message });
      }
    }, config.cleanupIntervalMinutes * 60 * 1000);
    timer.unref?.();
  }

  async function close() {
    if (timer) clearInterval(timer);
    streams.shutdown();
    await app.close();
  }

  return { app, config, storage, streams, media, validation, tools, log, close };
}

async function main() {
  let ctx;
  try {
    ctx = await createApp();
    await ctx.app.listen({ host: ctx.config.host, port: ctx.config.port });
    ctx.log.info('listening', { host: ctx.config.host, port: ctx.config.port });
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Startup failed');
    process.exit(1);
  }

  let closing = false;
  const shutdown = async (signal) => {
    if (closing) return;
    closing = true;
    const timer = setTimeout(() => process.exit(1), (ctx.config.workerShutdownSeconds + 5) * 1000);
    try {
      ctx.log.info('shutting down', { signal });
      await ctx.close();
      clearTimeout(timer);
      process.exit(0);
    } catch (error) {
      console.error(error instanceof Error ? error.message : 'Shutdown failed');
      process.exit(1);
    }
  };
  process.on('SIGINT', () => { shutdown('SIGINT'); });
  process.on('SIGTERM', () => { shutdown('SIGTERM'); });
}

const entry = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : '';
if (import.meta.url === entry) main();
