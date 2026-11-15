import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultSettings, normalizeSettings, defaultSchedule, defaultCoaches, normalizeCoaches, availableGroups, normalizeSchedule, groupLabel } from '../src/data.js';
import { validEndpoint, apiRequest } from '../src/api.js';

test('Settings use Kokshetau when missing or loaded from the previous Astana defaults', () => {
  assert.equal(defaultSettings.location, 'Кокшетау');
  for (const input of [undefined, null, {}, { location: '' }, { location: ' ' }, { location: 42 }, { location: 'Астана' }, { location: '  аСтАнА  ' }]) {
    assert.equal(normalizeSettings(input).location, 'Кокшетау');
  }
  for (const heroDescription of ['Плавание для детей и взрослых в Астане.', 'Школа плавания для детей и взрослых в Астане. От первого вдоха до уверенной техники.']) {
    const settings = normalizeSettings({ location: 'Астана', heroDescription });
    assert.equal(settings.location, 'Кокшетау');
    assert.equal(settings.heroDescription, defaultSettings.heroDescription);
    assert.match(settings.heroDescription, /в Кокшетау/);
  }
  const custom = { location: 'Кокшетау, бассейн клуба', heroDescription: 'Наше расписание и занятия', coachName: 'Имя от менеджера', contactNote: '', ignored: 'not public' };
  const settings = normalizeSettings(custom);
  for (const key of ['location', 'heroDescription', 'coachName', 'contactNote']) assert.equal(settings[key], custom[key]);
  assert.equal(normalizeSettings({ location: 'Алматы' }).location, 'Алматы');
  assert.equal(Object.hasOwn(settings, 'ignored'), false);
});

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

test('Coach data preserves the supplied team and accepts the manager API contract', () => {
  assert.deepEqual(normalizeCoaches(defaultCoaches), defaultCoaches);
  assert.equal(defaultCoaches.filter(coach => coach.senior).length, 1);
  assert.equal(defaultCoaches.find(coach => coach.senior).name, 'Медхат Даиров');
  assert.equal(defaultCoaches.find(coach => coach.id === 'erik').name, 'Раскулов Эрик Рустамович');
  assert.deepEqual(normalizeCoaches([]), []);
  assert.equal(normalizeCoaches([{ ...defaultCoaches[1], id: 'Coach_01', image: '/images/PORTRAIT.AVIF' }])[0].id, 'Coach_01');
  assert.equal(normalizeCoaches([{ ...defaultCoaches[1], image: 'https://example.com/portrait.jpg' }])[0].image, 'https://example.com/portrait.jpg');
  for (const patch of [{ id: '../coach' }, { active: 'false' }, { senior: 1 }, { image: 'javascript:alert(1)' }, { image: '//example.com/image.jpg' }, { image: 'https://user:password@example.com/image.jpg' }, { image: '/images/../secret.png' }, { name: ' ' }]) {
    assert.throws(() => normalizeCoaches([{ ...defaultCoaches[1], ...patch }]));
  }
  assert.throws(() => normalizeCoaches([defaultCoaches[1], defaultCoaches[1]]));
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
