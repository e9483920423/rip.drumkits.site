const RANK = { silent: 100, error: 40, warn: 30, info: 20, debug: 10 };

export function createLogger(level = 'info') {
  const threshold = RANK[level] ?? RANK.info;

  function write(lvl, msg, fields = {}) {
    if ((RANK[lvl] ?? RANK.info) < threshold) return;
    const line = JSON.stringify({
      time: new Date().toISOString(),
      level: lvl,
      msg,
      ...fields,
    });
    if (lvl === 'error') console.error(line);
    else console.log(line);
  }

  return {
    debug: (msg, fields) => write('debug', msg, fields),
    info: (msg, fields) => write('info', msg, fields),
    warn: (msg, fields) => write('warn', msg, fields),
    error: (msg, fields) => write('error', msg, fields),
  };
}
