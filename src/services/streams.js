import { randomUUID } from 'node:crypto';
import { AppError } from '../errors.js';
import { assertJobId } from './storage.js';

export function createStreamManager({ maxConcurrent, ttlMs = 60_000, now = Date.now } = {}) {
  const tickets = new Map();
  const inflight = new Set();

  function purge() {
    const time = now();
    for (const [id, ticket] of tickets) {
      if (ticket.expires <= time) tickets.delete(id);
    }
  }

  function issue(payload) {
    purge();
    if (inflight.size >= maxConcurrent) {
      throw new AppError('queue_full', 'A download is already running. Wait for it to finish.', 429);
    }
    const id = randomUUID();
    tickets.set(id, { ...payload, id, expires: now() + ttlMs });
    return id;
  }

  function consume(id) {
    assertJobId(id);
    purge();
    const ticket = tickets.get(id);
    if (!ticket) return null;
    tickets.delete(id);
    return ticket;
  }

  function begin(id) {
    if (inflight.size >= maxConcurrent) return false;
    inflight.add(id);
    return true;
  }

  function end(id) {
    inflight.delete(id);
  }

  function restore(ticket) {
    tickets.set(ticket.id, ticket);
  }

  function activeIds() {
    return [...inflight];
  }

  function shutdown() {
    tickets.clear();
  }

  return {
    issue,
    consume,
    begin,
    end,
    restore,
    activeIds,
    shutdown,
    get active() {
      return inflight.size;
    },
  };
}
