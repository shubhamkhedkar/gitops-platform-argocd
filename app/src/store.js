'use strict';

const { randomUUID } = require('node:crypto');

const seedReservations = [
  {
    id: 'r-1001',
    resource: 'room-a',
    requester: 'alex',
    start: '2026-11-08T09:00:00.000Z',
    end: '2026-11-08T10:00:00.000Z',
    purpose: 'planning',
  },
  {
    id: 'r-1002',
    resource: 'room-b',
    requester: 'jordan',
    start: '2026-11-08T13:00:00.000Z',
    end: '2026-11-08T14:30:00.000Z',
    purpose: 'interview',
  },
];

function overlaps(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && bStart < aEnd;
}

function parseInstant(value) {
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) return null;
  return { iso: new Date(ms).toISOString(), ms };
}

function validateReservation(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { error: 'Body must be a JSON object' };
  }
  const resource = typeof input.resource === 'string' ? input.resource.trim() : '';
  const requester = typeof input.requester === 'string' ? input.requester.trim() : '';
  const purpose = typeof input.purpose === 'string' ? input.purpose.trim() : '';
  if (!resource) return { error: 'resource is required' };
  if (!requester) return { error: 'requester is required' };
  const start = parseInstant(input.start);
  const end = parseInstant(input.end);
  if (!start) return { error: 'start must be an ISO-8601 timestamp' };
  if (!end) return { error: 'end must be an ISO-8601 timestamp' };
  if (start.ms >= end.ms) return { error: 'start must be before end' };
  return {
    value: {
      resource,
      requester,
      start: start.iso,
      end: end.iso,
      purpose,
    },
  };
}

function createStore({ seed = seedReservations, idFactory } = {}) {
  const items = seed.map((item) => ({ ...item }));
  let conflicts = 0;

  function list(resource) {
    const filtered = resource ? items.filter((item) => item.resource === resource) : items;
    return filtered.map((item) => ({ ...item }));
  }

  function get(id) {
    const found = items.find((item) => item.id === id);
    return found ? { ...found } : null;
  }

  function resources() {
    return [...new Set(items.map((item) => item.resource))].sort();
  }

  function create(input) {
    const checked = validateReservation(input);
    if (checked.error) return { error: checked.error, status: 400 };
    const next = checked.value;
    const startMs = Date.parse(next.start);
    const endMs = Date.parse(next.end);
    const clash = items.some((item) => (
      item.resource === next.resource
      && overlaps(startMs, endMs, Date.parse(item.start), Date.parse(item.end))
    ));
    if (clash) {
      conflicts += 1;
      return { error: 'resource is already reserved for that time range', status: 409 };
    }
    const created = {
      id: idFactory ? idFactory() : `r-${randomUUID()}`,
      ...next,
    };
    items.push(created);
    return { value: { ...created } };
  }

  function remove(id) {
    const index = items.findIndex((item) => item.id === id);
    if (index === -1) return null;
    const [deleted] = items.splice(index, 1);
    return { ...deleted };
  }

  function stats() {
    return { count: items.length, conflicts };
  }

  return { list, get, resources, create, remove, stats, validateReservation };
}

module.exports = {
  createStore,
  validateReservation,
  overlaps,
  parseInstant,
  seedReservations,
};
