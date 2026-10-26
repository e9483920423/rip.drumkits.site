import path from 'node:path';

const LOG_LEVELS = new Set(['silent', 'debug', 'info', 'warn', 'error']);
const LOOPBACK = new Set(['127.0.0.1', '::1', 'localhost', '[::1]']);

function raw(env, name) {
  const value = env[name];
  if (value === undefined || value === null) return undefined;
  return String(value);
}

function integer(env, name, fallback, min, max) {
  const value = raw(env, name);
  if (value === undefined || value.trim() === '') return fallback;
  const text = value.trim();
  if (!/^-?\d+$/.test(text)) {
    throw new Error(`${name} must be an integer`);
  }
  const parsed = Number(text);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${name} must be between ${min} and ${max}`);
  }
  return parsed;
}

function text(env, name, fallback) {
  const value = raw(env, name);
  if (value === undefined || value.trim() === '') return fallback;
  return value.trim();
}

function resolvePath(cwd, value, label) {
  if (value.includes('\0') || value.includes('\n') || value.includes('\r')) {
    throw new Error(`${label} contains an invalid character`);
  }
  return path.resolve(cwd, value);
}

function executable(env, name, fallback) {
  const value = text(env, name, fallback);
  if (value.startsWith('-') || value.includes('\0') || value.includes('\n') || value.includes('\r')) {
    throw new Error(`${name} must be an executable name or path`);
  }
  return value;
}

export function isLoopbackHost(host) {
  return LOOPBACK.has(String(host).trim().toLowerCase());
}

export function loadConfig(env = process.env, cwd = process.cwd()) {
  const host = text(env, 'HOST', '127.0.0.1');
  if (host.length > 255 || /[\s/\\]/.test(host) || host.includes('://')) {
    throw new Error('HOST must be a hostname or IP address');
  }

  const port = integer(env, 'PORT', 3000, 0, 65535);
  const dataDir = resolvePath(cwd, text(env, 'DATA_DIR', './data'), 'DATA_DIR');
  const downloadDir = resolvePath(cwd, text(env, 'DOWNLOAD_DIR', './downloads'), 'DOWNLOAD_DIR');
  const dbPath = resolvePath(cwd, text(env, 'DB_PATH', './data/app.db'), 'DB_PATH');
  const logLevel = text(env, 'LOG_LEVEL', 'info').toLowerCase();
  if (!LOG_LEVELS.has(logLevel)) {
    throw new Error('LOG_LEVEL must be silent, debug, info, warn, or error');
  }

  const tmpDir = path.resolve(dataDir, 'tmp');
  if (downloadDir === tmpDir || dataDir === downloadDir) {
    throw new Error('DOWNLOAD_DIR must be separate from DATA_DIR and its tmp folder');
  }

  return {
    host,
    port,
    dataDir,
    downloadDir,
    tmpDir,
    dbPath,
    ytdlpPath: executable(env, 'YTDLP_PATH', 'yt-dlp'),
    ffmpegPath: executable(env, 'FFMPEG_PATH', 'ffmpeg'),
    maxConcurrentJobs: integer(env, 'MAX_CONCURRENT_JOBS', 1, 1, 8),
    maxQueuedJobs: integer(env, 'MAX_QUEUED_JOBS', 10, 1, 100),
    maxFileSizeMb: integer(env, 'MAX_FILE_SIZE_MB', 500, 1, 10240),
    maxPlaylistEntries: integer(env, 'MAX_PLAYLIST_ENTRIES', 100, 1, 500),
    maxZipItems: integer(env, 'MAX_ZIP_ITEMS', 20, 1, 50),
    maxZipSizeMb: integer(env, 'MAX_ZIP_SIZE_MB', 2048, 1, 10240),
    maxDurationSeconds: integer(env, 'MAX_DURATION_SECONDS', 7200, 1, 86400),
    jobTimeoutSeconds: integer(env, 'JOB_TIMEOUT_SECONDS', 1800, 30, 86400),
    fileRetentionHours: integer(env, 'FILE_RETENTION_HOURS', 24, 1, 8760),
    tempRetentionHours: integer(env, 'TEMP_RETENTION_HOURS', 6, 1, 8760),
    maxJobHistory: integer(env, 'MAX_JOB_HISTORY', 200, 10, 10000),
    cleanupIntervalMinutes: integer(env, 'CLEANUP_INTERVAL_MINUTES', 15, 0, 1440),
    workerShutdownSeconds: integer(env, 'WORKER_SHUTDOWN_SECONDS', 10, 1, 120),
    bodyLimitBytes: integer(env, 'BODY_LIMIT_BYTES', 16384, 1024, 65536),
    rateLimitPerMinute: integer(env, 'RATE_LIMIT_PER_MINUTE', 60, 1, 1000),
    logLevel,
  };
}
