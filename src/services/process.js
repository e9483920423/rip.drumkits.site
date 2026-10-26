import { spawn } from 'node:child_process';
import path from 'node:path';

function expandCommand(command, args) {
  if (typeof command === 'string' && command.toLowerCase().endsWith('.js')) {
    return { command: process.execPath, args: [path.resolve(command), ...args] };
  }
  return { command, args };
}

function killTree(child) {
  if (!child?.pid) return;
  if (process.platform === 'win32') {
    spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
      shell: false,
      windowsHide: true,
      stdio: 'ignore',
    });
    return;
  }
  try {
    process.kill(-child.pid, 'SIGTERM');
  } catch {
    try {
      child.kill('SIGTERM');
    } catch {
      // The process has already exited.
    }
  }
}

function consume(stream, onChunk, onLine) {
  let carry = '';
  stream.setEncoding('utf8');
  stream.on('data', (text) => {
    onChunk(text);
    carry += text;
    const lines = carry.split(/\r?\n/);
    carry = lines.pop() ?? '';
    for (const line of lines) {
      if (line) onLine(line);
    }
  });
  stream.on('end', () => {
    if (carry) onLine(carry);
  });
}

export function runProcess(command, args, options = {}) {
  const timeoutMs = options.timeoutMs ?? 30_000;
  const stdoutCap = options.stdoutCap ?? 2_000_000;
  const expanded = expandCommand(command, args);

  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(expanded.command, expanded.args, {
        cwd: options.cwd,
        shell: false,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: process.platform !== 'win32',
      });
    } catch (error) {
      reject(error);
      return;
    }

    let stderrBuf = '';
    let stdoutBuf = '';
    let settled = false;
    let killReason = '';

    consume(
      child.stdout,
      (text) => {
        stdoutBuf = (stdoutBuf + text).slice(-stdoutCap);
        if (stdoutBuf.length >= stdoutCap) requestKill('output');
      },
      (line) => options.onLine?.(line, false),
    );
    consume(
      child.stderr,
      (text) => {
        stderrBuf = (stderrBuf + text).slice(-16_384);
      },
      (line) => options.onLine?.(line, true),
    );

    const timer = setTimeout(() => requestKill('timeout'), timeoutMs);
    const hard = setTimeout(() => {
      if (!killReason) killReason = 'timeout';
      finish(1, 'SIGKILL');
    }, timeoutMs + 8000);

    function finish(code, signal) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(hard);
      resolve({
        code: code ?? 1,
        signal: signal ?? null,
        stderr: stderrBuf,
        stdout: stdoutBuf,
        timedOut: killReason === 'timeout',
        cancelled: killReason === 'cancelled',
        outputLimited: killReason === 'output',
      });
    }

    function requestKill(reason) {
      if (killReason || settled) return;
      killReason = reason;
      killTree(child);
      const later = setTimeout(() => {
        try {
          child.kill('SIGKILL');
        } catch {
          // The process has already exited.
        }
      }, 4000);
      later.unref?.();
    }

    if (options.signal) {
      if (options.signal.aborted) requestKill('cancelled');
      else options.signal.addEventListener('abort', () => requestKill('cancelled'), { once: true });
    }

    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(hard);
      error.stderr = stderrBuf;
      reject(error);
    });

    child.on('close', (code, signal) => finish(code ?? 1, signal));
  });
}

export function streamProcess(command, args, options = {}) {
  const timeoutMs = options.timeoutMs ?? 30_000;
  const maxBytes = options.maxBytes ?? 500 * 1024 * 1024;
  const expanded = expandCommand(command, args);

  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(expanded.command, expanded.args, {
        cwd: options.cwd,
        shell: false,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: process.platform !== 'win32',
      });
    } catch (error) {
      reject(error);
      return;
    }

    let stderrBuf = '';
    let bytes = 0;
    let first = true;
    let settled = false;
    let killReason = '';

    child.stdout.on('data', (chunk) => {
      bytes += chunk.length;
      if (bytes > maxBytes) {
        requestKill('too_large');
        return;
      }
      try {
        if (first) {
          first = false;
          options.onFirstByte?.(chunk);
        } else {
          options.write?.(chunk);
        }
      } catch (error) {
        requestKill('cancelled');
        reject(error);
      }
    });

    consume(
      child.stderr,
      (text) => {
        stderrBuf = (stderrBuf + text).slice(-16_384);
      },
      () => {},
    );

    const timer = setTimeout(() => requestKill('timeout'), timeoutMs);
    const hard = setTimeout(() => {
      if (!killReason) killReason = 'timeout';
      finish(1, 'SIGKILL');
    }, timeoutMs + 8000);

    function finish(code, signal) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(hard);
      resolve({
        code: code ?? 1,
        signal: signal ?? null,
        stderr: stderrBuf,
        bytes,
        timedOut: killReason === 'timeout',
        cancelled: killReason === 'cancelled',
        tooLarge: killReason === 'too_large',
        started: !first,
      });
    }

    function requestKill(reason) {
      if (killReason || settled) return;
      killReason = reason;
      killTree(child);
      const later = setTimeout(() => {
        try {
          child.kill('SIGKILL');
        } catch {
          // The process has already exited.
        }
      }, 4000);
      later.unref?.();
    }

    if (options.signal) {
      if (options.signal.aborted) requestKill('cancelled');
      else options.signal.addEventListener('abort', () => requestKill('cancelled'), { once: true });
    }

    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(hard);
      error.stderr = stderrBuf;
      reject(error);
    });

    child.on('close', (code, signal) => finish(code ?? 1, signal));
  });
}
