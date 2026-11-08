'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createStore, overlaps, validateReservation } = require('../src/store');

test('overlaps detects intersecting intervals and allows back-to-back bookings', () => {
  assert.equal(overlaps(0, 10, 5, 15), true);
  assert.equal(overlaps(0, 10, 10, 20), false);
  assert.equal(overlaps(10, 20, 0, 10), false);
  assert.equal(overlaps(0, 10, 0, 10), true);
});

test('validateReservation rejects missing fields and inverted ranges', () => {
  assert.equal(validateReservation(null).error, 'Body must be a JSON object');
  assert.match(validateReservation({}).error, /resource/);
  assert.match(validateReservation({ resource: 'room-a' }).error, /requester/);
  assert.match(validateReservation({
    resource: 'room-a', requester: 'alex', start: 'nope', end: '2026-11-08T11:00:00.000Z',
  }).error, /start/);
  assert.match(validateReservation({
    resource: 'room-a', requester: 'alex',
    start: '2026-11-08T11:00:00.000Z', end: '2026-11-08T10:00:00.000Z',
  }).error, /before end/);
});

test('createStore lists seed data and can filter by resource', () => {
  const store = createStore();
  assert.equal(store.list().length, 2);
  assert.equal(store.list('room-a').length, 1);
  assert.equal(store.list('room-z').length, 0);
  assert.deepEqual(store.resources(), ['room-a', 'room-b']);
});

test('createStore get returns a copy or null', () => {
  const store = createStore();
  const found = store.get('r-1001');
  assert.equal(found.resource, 'room-a');
  found.resource = 'mutated';
  assert.equal(store.get('r-1001').resource, 'room-a');
  assert.equal(store.get('missing'), null);
});

test('createStore creates a reservation and rejects conflicts on the same resource', () => {
  const store = createStore({ seed: [], idFactory: () => 'r-fixed' });
  const created = store.create({
    resource: 'desk-1',
    requester: 'sam',
    start: '2026-11-08T10:00:00.000Z',
    end: '2026-11-08T11:00:00.000Z',
    purpose: 'focus work',
  });
  assert.equal(created.value.id, 'r-fixed');
  assert.equal(created.value.purpose, 'focus work');

  const conflict = store.create({
    resource: 'desk-1',
    requester: 'riley',
    start: '2026-11-08T10:30:00.000Z',
    end: '2026-11-08T11:30:00.000Z',
  });
  assert.equal(conflict.status, 409);
  assert.equal(store.stats().conflicts, 1);

  const adjacent = store.create({
    resource: 'desk-1',
    requester: 'riley',
    start: '2026-11-08T11:00:00.000Z',
    end: '2026-11-08T12:00:00.000Z',
  });
  assert.ok(adjacent.value);

  const otherResource = store.create({
    resource: 'desk-2',
    requester: 'riley',
    start: '2026-11-08T10:30:00.000Z',
    end: '2026-11-08T11:30:00.000Z',
  });
  assert.ok(otherResource.value);
});

test('createStore remove deletes by id', () => {
  const store = createStore();
  assert.equal(store.remove('r-1001').id, 'r-1001');
  assert.equal(store.get('r-1001'), null);
  assert.equal(store.remove('r-1001'), null);
});
