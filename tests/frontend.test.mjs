import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultSchedule, availableGroups, normalizeSchedule, groupLabel } from '../src/data.js';
import { validEndpoint, apiRequest } from '../src/api.js';

test('All fifteen requested groups and their days match the brief', () => {
  assert.equal(defaultSchedule.length, 15);
  const children = defaultSchedule.filter(g => g.audience === 'children');
  assert.equal(children.length, 8);
  assert.deepEqual(children.filter(g => g.days.includes('mon')).map(g => g.start), ['08:00', '15:00', '19:00', '20:00']);
  assert.deepEqual(children.filter(g => g.days.includes('sat')).map(g => g.start), ['08:00', '16:00', '19:00', '20:00']);
  const adults = defaultSchedule.filter(g => g.audience === 'adults');
  assert.deepEqual(adults.filter(g => g.days.includes('mon')).map(g => g.start), ['08:00', '12:00', '13:00', '19:00', '21:00']);
  assert.deepEqual(adults.filter(g => g.days.includes('tue')).map(g => g.start), ['08:00', '12:00']);
  assert.equal(adults.some(g => g.days.includes('sat')), false);
  for (const group of defaultSchedule) assert.equal(Number(group.end.slice(0, 2)) - Number(group.start.slice(0, 2)), 1);
});

test('Master and closed groups cannot appear in the public signup selector', () => {
  assert.equal(availableGroups(defaultSchedule, 'adults').length, 5);
  assert.deepEqual(defaultSchedule.filter(g => g.level === 'master').map(g => g.start), ['13:00', '19:00']);
  assert.equal(availableGroups(defaultSchedule.map(g => ({ ...g, active: false })), 'children').length, 0);
});

test('Remote schedule validation rejects invalid or ambiguous data, accepts intentional empty schedule', () => {
  assert.deepEqual(normalizeSchedule(defaultSchedule), defaultSchedule);
  assert.deepEqual(normalizeSchedule([]), []);
  for (const patch of [{ days: ['holiday'] }, { start: '25:00' }, { end: '07:00' }, { active: 'false' }, { level: 'unknown' }, { audience: 'everyone' }]) {
    assert.throws(() => normalizeSchedule([{ ...defaultSchedule[0], ...patch }]));
  }
  assert.throws(() => normalizeSchedule([defaultSchedule[0], defaultSchedule[0]]));
  assert.equal(groupLabel(defaultSchedule[0]), 'Пн / Ср / Пт · 08:00–09:00');
});

test('Only deployed Google Apps Script HTTPS endpoints are accepted', () => {
  assert.equal(validEndpoint('https://script.google.com/macros/s/ABC-123_xyz/exec'), true);
  for (const url of ['', 'javascript:alert(1)', 'https://example.com/exec', 'https://script.google.com.evil.test/macros/s/ABC/exec', 'http://script.google.com/macros/s/ABC/exec', 'https://script.google.com/macros/s/ABC/dev']) {
    assert.equal(validEndpoint(url), false);
  }
});

test('POST uses text/plain to avoid CORS preflight and only accepts confirmed API success', async t => {
  const endpoint = 'https://script.google.com/macros/s/ABC/exec';
  const originalFetch = global.fetch;
  t.after(() => { global.fetch = originalFetch; });
  global.fetch = async (url, options) => {
    assert.equal(options.headers['Content-Type'], 'text/plain;charset=UTF-8');
    assert.deepEqual(JSON.parse(options.body), { action: 'register' });
    return { ok: true, json: async () => ({ ok: true, notificationSent: false }) };
  };
  assert.equal((await apiRequest(endpoint, { action: 'register' }, { method: 'POST' })).ok, true);
  global.fetch = async () => ({ ok: true, json: async () => ({ ok: false, error: { message: 'Группа закрыта' } }) });
  await assert.rejects(apiRequest(endpoint, {}, { method: 'POST' }), /Группа закрыта/);
  global.fetch = async () => ({ ok: true, json: async () => { throw new Error(); } });
  await assert.rejects(apiRequest(endpoint, {}, { method: 'POST' }), /не ответил/);
  global.fetch = async () => ({ ok: false });
  await assert.rejects(apiRequest(endpoint, {}, { method: 'POST' }), /недоступен/);
});
