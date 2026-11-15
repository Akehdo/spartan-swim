import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../google-apps-script/Code.gs', import.meta.url), 'utf8');

class Sheet {
  rows = [];
  getLastRow() { return this.rows.length; }
  appendRow(row) { this.rows.push([...row]); }
  setFrozenRows() {}
  autoResizeColumns() {}
  getRange(startRow, startColumn, rowCount = 1, columnCount = 1) {
    const sheet = this;
    const range = {
      getValues() {
        return Array.from({ length: rowCount }, (_, row) =>
          Array.from({ length: columnCount }, (_, column) => sheet.rows[startRow - 1 + row]?.[startColumn - 1 + column] ?? ''));
      },
      getDisplayValues() {
        return this.getValues().map(row => row.map(value => typeof value === 'boolean' ? String(value).toUpperCase() : String(value)));
      },
      setValues(values) {
        values.forEach((row, index) => {
          sheet.rows[startRow - 1 + index] ??= [];
          row.forEach((value, column) => { sheet.rows[startRow - 1 + index][startColumn - 1 + column] = value; });
        });
        return range;
      },
      setValue(value) { return this.setValues([[value]]); },
      setNumberFormat() { return range; },
      setFontWeight() { return range; },
      setBackground() { return range; }
    };
    return range;
  }
}

function harness({ telegram = true, notificationFlushFails = false } = {}) {
  const sheets = new Map();
  const properties = new Map(telegram ? [['TELEGRAM_BOT_TOKEN', 'test-private-token'], ['TELEGRAM_CHAT_ID', '123456']] : []);
  const cache = new Map();
  const triggers = [];
  const messages = [];
  const events = [];
  let flushCount = 0;
  let uuid = 0;
  let deliverySucceeds = true;
  const spreadsheet = {
    getId: () => 'test-spreadsheet',
    getSheetByName: name => sheets.get(name),
    insertSheet(name) { const sheet = new Sheet(); sheets.set(name, sheet); return sheet; }
  };
  const context = vm.createContext({
    SpreadsheetApp: { getActiveSpreadsheet: () => spreadsheet, openById: () => spreadsheet, flush() {
      events.push('flush');
      if (++flushCount === 2 && notificationFlushFails) throw new Error('notification flush failed');
    } },
    PropertiesService: { getScriptProperties: () => ({
      getProperty: key => properties.get(key) ?? null,
      setProperty(key, value) { properties.set(key, value); }
    }) },
    ScriptApp: {
      getProjectTriggers: () => triggers,
      newTrigger(name) {
        const builder = { timeBased: () => builder, everyMinutes: () => builder,
          create() { triggers.push({ getHandlerFunction: () => name }); } };
        return builder;
      }
    },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() { events.push('release'); } }) },
    CacheService: { getScriptCache: () => ({ get: key => cache.get(key), put: (key, value) => cache.set(key, value) }) },
    Utilities: {
      getUuid: () => `00000000-0000-4000-8000-${String(++uuid).padStart(12, '0')}`,
      DigestAlgorithm: { SHA_256: 'sha256' },
      computeDigest: (algorithm, value) => [...createHash(algorithm).update(value).digest()],
      base64EncodeWebSafe: value => Buffer.from(value).toString('base64url')
    },
    UrlFetchApp: {
      fetch(url, options) {
        events.push('telegram');
        messages.push({ url, ...options, data: JSON.parse(options.payload) });
        return { getResponseCode: () => deliverySucceeds ? 200 : 500,
          getContentText: () => JSON.stringify({ ok: deliverySucceeds }) };
      }
    },
    ContentService: { MimeType: { JSON: 'application/json' },
      createTextOutput: body => ({ body, setMimeType() { return this; } }) }
  });
  vm.runInContext(source, context);
  context.setup();
  return {
    context, sheets, properties, messages, triggers, events,
    failTelegram: () => { deliverySucceeds = false; },
    restoreTelegram: () => { deliverySucceeds = true; },
    get: () => JSON.parse(context.doGet({ parameter: { action: 'bootstrap' } }).body),
    post: input => JSON.parse(context.doPost({ postData: { contents: JSON.stringify(input) } }).body)
  };
}

function registration(overrides = {}) {
  return { action: 'register', groupId: 'children-mwf-0800', name: 'Анна', phone: '+7 707 000 1234',
    participantName: 'Саша', age: 8, experience: 'beginner', consent: true, website: '',
    requestId: '11111111-2222-4333-8444-555555555555', ...overrides };
}

test('public bootstrap exposes exact 15 groups and safe settings, never applications or secrets', () => {
  const h = harness();
  h.post(registration());
  const body = h.get();
  assert.equal(body.ok, true);
  assert.equal(body.schedule.length, 15);
  assert.deepEqual(body.schedule.filter(group => group.level === 'master').map(group => group.id),
    ['adults-mwf-1300', 'adults-mwf-1900']);
  assert.equal(body.settings.coachName, 'Медхат Даиров');
  assert.equal(body.settings.phone, '+7 707 620 4904');
  assert.equal(body.schedule.filter(group => group.audience === 'children').length, 8);
  assert.equal(body.schedule.filter(group => group.audience === 'adults').length, 7);
  assert.equal(body.settings.brandName, 'SPARTAN SWIM');
  assert.equal(body.settings.location, 'Кокшетау');
  assert.equal(body.settings.heroDescription, 'Школа плавания для детей и взрослых в Кокшетау. От первого вдоха до уверенной техники.');
  assert.equal(body.coaches.length, 4);
  assert.equal(body.coaches.find(coach => coach.id === 'erik').name, 'Раскулов Эрик Рустамович');
  assert.deepEqual(body.coaches.filter(coach => coach.senior).map(coach => coach.id), ['medhat']);
  assert.deepEqual(Object.keys(body).sort(), ['coaches', 'ok', 'schedule', 'settings']);
  assert.doesNotMatch(JSON.stringify(body), /test-private-token|Анна|000 1234/);
});

test('a child application is durably saved, formulas escaped, and sent as plain Telegram text', () => {
  const h = harness();
  const body = h.post(registration({ name: '=HYPERLINK("bad")', participantName: '<b>Саша</b>' }));
  assert.equal(body.ok, true);
  assert.equal(body.notificationSent, true);
  const rows = h.sheets.get('Заявки').rows;
  assert.equal(rows.length, 2);
  assert.equal(rows[1][3], '\'=HYPERLINK("bad")');
  assert.equal(rows[1][4], "'+7 707 000 1234");
  assert.equal(rows[1][11], 'sent');
  assert.equal(rows[1][12], 1);
  assert.equal(h.messages.length, 1);
  assert.equal(h.messages[0].data.parse_mode, undefined);
  assert.equal(h.messages[0].timeoutSeconds, undefined);
  assert.match(h.messages[0].data.text, /<b>Саша<\/b>/);
  assert.match(h.messages[0].data.text, /ПН СР ПТ · 08:00–09:00/);
  assert.match(h.messages[0].data.text, /https:\/\/wa\.me\/77070001234/);
  assert.doesNotMatch(h.messages[0].data.text, /Заявка:/);
  assert.equal(h.messages[0].data.text.includes(body.registrationId), false);
});

test('master, inactive, and unknown groups cannot be booked by a forged client', () => {
  for (const groupId of ['adults-mwf-1300', 'adults-mwf-1900', 'invented-group']) {
    const h = harness();
    const body = h.post(registration({ groupId, experience: 'confident' }));
    assert.equal(body.ok, false);
    assert.equal(h.sheets.get('Заявки').rows.length, 1);
    assert.equal(h.messages.length, 0);
  }
  const h = harness();
  h.sheets.get('Расписание').rows[1][6] = false;
  assert.equal(h.post(registration()).error.code, 'GROUP_UNAVAILABLE');
  assert.equal(h.sheets.get('Заявки').rows.length, 1);
});

test('missing consent, child details, invalid phones and honeypot reject without persistence', () => {
  const cases = [
    [{ consent: false }, 'CONSENT_REQUIRED'], [{ age: '' }, 'CHILD_DETAILS_REQUIRED'],
    [{ participantName: '' }, 'CHILD_DETAILS_REQUIRED'], [{ age: 18 }, 'INVALID_AGE'],
    [{ phone: '123' }, 'INVALID_PHONE'], [{ website: 'bot.example' }, 'INVALID_REQUEST']
  ];
  for (const [overrides, code] of cases) {
    const h = harness();
    assert.equal(h.post(registration(overrides)).error.code, code);
    assert.equal(h.sheets.get('Заявки').rows.length, 1);
    assert.equal(h.messages.length, 0);
  }
});

test('network retry with same requestId never duplicates sheet rows or Telegram messages', () => {
  const h = harness();
  const first = h.post(registration());
  const second = h.post(registration());
  assert.equal(first.registrationId, second.registrationId);
  assert.equal(second.duplicate, true);
  assert.equal(second.notificationSent, true);
  assert.equal(h.sheets.get('Заявки').rows.length, 2);
  assert.equal(h.messages.length, 1);
});

test('Telegram failure preserves application, reports delivery false, and background retry recovers', () => {
  const h = harness();
  h.failTelegram();
  const result = h.post(registration());
  assert.equal(result.ok, true);
  assert.equal(result.notificationSent, false);
  assert.equal(h.sheets.get('Заявки').rows[1][11], 'error');
  h.restoreTelegram();
  h.context.retryFailedNotifications();
  h.context.retryFailedNotifications();
  assert.equal(h.sheets.get('Заявки').rows[1][11], 'sent');
  assert.equal(h.sheets.get('Заявки').rows[1][12], 2);
  assert.equal(h.messages.length, 2);
  assert.equal(h.sheets.get('Заявки').rows.length, 2);
});

test('missing bot credentials never claims delivery and can recover after configuration', () => {
  const h = harness({ telegram: false });
  assert.equal(h.post(registration()).notificationSent, false);
  assert.equal(h.sheets.get('Заявки').rows[1][11], 'not_configured');
  assert.equal(h.messages.length, 0);
  h.properties.set('TELEGRAM_BOT_TOKEN', 'new-private-token');
  h.properties.set('TELEGRAM_CHAT_ID', '123456');
  h.context.retryFailedNotifications();
  assert.equal(h.sheets.get('Заявки').rows[1][11], 'sent');
  assert.equal(h.messages.length, 1);
});

test('delivery status is flushed before lock release and flush failure preserves the saved application', () => {
  const h = harness({ notificationFlushFails: true });
  const result = h.post(registration());
  assert.equal(result.ok, true);
  assert.equal(result.notificationSent, false);
  assert.equal(h.sheets.get('Заявки').rows.length, 2);
  assert.equal(h.messages.length, 1);
  assert.deepEqual(h.events, ['flush', 'release', 'telegram', 'flush', 'release']);
  assert.equal(h.post(registration()).duplicate, true);
  assert.equal(h.sheets.get('Заявки').rows.length, 2);
});

test('rerunning setup preserves trainer edits, saved applications, and one retry trigger', () => {
  const h = harness();
  h.post(registration());
  h.sheets.get('Настройки').rows.find(row => row[0] === 'coachName')[1] = 'Новое имя';
  h.sheets.get('Расписание').rows[1][3] = '10:00';
  h.sheets.get('Расписание').rows[1][4] = '11:00';
  h.context.setup();
  assert.equal(h.get().settings.coachName, 'Новое имя');
  assert.equal(h.get().schedule[0].start, '10:00');
  assert.equal(h.sheets.get('Заявки').rows.length, 2);
  assert.equal(h.triggers.length, 1);
});

test('setup adds missing editable text settings while preserving existing trainer copy', () => {
  const h = harness();
  const settings = h.sheets.get('Настройки');
  settings.rows = settings.rows.filter(row => row[0] !== 'coachIntro');
  settings.rows.find(row => row[0] === 'childrenTitle')[1] = 'Заголовок от тренера';
  h.context.setup();
  const result = h.get().settings;
  assert.equal(result.childrenTitle, 'Заголовок от тренера');
  assert.match(result.coachIntro, /Старший тренер Spartan Swim\./);
  assert.equal(result.adultsTitle, 'Свобода движения.');
  assert.equal(settings.rows.filter(row => row[0] === 'coachIntro').length, 1);
});

test('server checks the current sheet and not the hours claimed by the visitor', () => {
  const h = harness();
  h.sheets.get('Расписание').rows[1][3] = '10:00';
  h.sheets.get('Расписание').rows[1][4] = '11:00';
  assert.equal(h.post(registration({ start: '08:00', end: '09:00' })).ok, true);
  assert.match(h.sheets.get('Заявки').rows[1][9], /10:00–11:00/);
});

test('repeated different requests from one phone are limited, duplicate retry is still allowed', () => {
  const h = harness();
  for (let index = 0; index < 6; index++) {
    assert.equal(h.post(registration({ requestId: `request-number-${index}` })).ok, true);
  }
  assert.equal(h.post(registration({ requestId: 'request-number-6' })).error.code, 'RATE_LIMIT');
  assert.equal(h.post(registration({ requestId: 'request-number-0' })).duplicate, true);
  assert.equal(h.sheets.get('Заявки').rows.length, 7);
});

test('selected coach is resolved from the current sheet and saved with the chosen schedule in Telegram', () => {
  const h = harness();
  h.sheets.get('Тренеры').rows.find(row => row[0] === 'erik')[1] = 'Эрик — имя от менеджера';
  const result = h.post(registration({ coachId: 'erik', coachName: 'Поддельное имя' }));
  assert.equal(result.ok, true);
  const row = h.sheets.get('Заявки').rows[1];
  assert.equal(row[8], 'children-mwf-0800');
  assert.match(row[9], /Дети · ПН СР ПТ · 08:00–09:00/);
  assert.equal(row[13], 'erik');
  assert.equal(row[14], 'Эрик — имя от менеджера');
  assert.match(h.messages[0].data.text, /SPARTAN SWIM/);
  assert.match(h.messages[0].data.text, /Тренер: Эрик — имя от менеджера \(предпочтение\)/);
  assert.doesNotMatch(h.messages[0].data.text, /Поддельное имя/);
  assert.equal(h.post(registration({ coachId: 'erik' })).duplicate, true);
  assert.equal(h.messages.length, 1);
});

test('unknown, inactive, and invalid coaches cannot be booked by a forged client', () => {
  for (const coachId of ['unknown-coach', '../erik', 12]) {
    const h = harness();
    assert.equal(h.post(registration({ coachId })).ok, false);
    assert.equal(h.sheets.get('Заявки').rows.length, 1);
    assert.equal(h.messages.length, 0);
  }
  const h = harness();
  h.sheets.get('Тренеры').rows.find(row => row[0] === 'erik')[5] = false;
  assert.equal(h.post(registration({ coachId: 'erik' })).error.code, 'COACH_UNAVAILABLE');
  assert.equal(h.sheets.get('Заявки').rows.length, 1);
  assert.equal(h.messages.length, 0);
  assert.equal(h.post(registration()).ok, true);
  assert.match(h.messages[0].data.text, /Тренер: Помочь с выбором/);
});

test('coach sheet supports manager edits and suppresses ambiguous or unsafe image entries', () => {
  const h = harness();
  const coaches = h.sheets.get('Тренеры');
  coaches.rows.find(row => row[0] === 'konstantin')[2] = 'Тренер детских групп';
  coaches.rows.push([...coaches.rows[1]]);
  coaches.rows.push(['unsafe', 'Имя тренера', 'Тренер', 'javascript:alert(1)', false, true]);
  coaches.rows.push(['credentials', 'Имя тренера', 'Тренер', 'https://user:password@example.com/image.jpg', false, true]);
  coaches.rows.push(['malformed', 'Имя тренера', 'Тренер', 'https:///', false, true]);
  assert.equal(h.get().coaches.length, 4);
  assert.equal(h.get().coaches.find(coach => coach.id === 'konstantin').role, 'Тренер детских групп');
  h.context.setup();
  assert.equal(h.get().coaches.find(coach => coach.id === 'konstantin').role, 'Тренер детских групп');
  assert.equal(coaches.rows.filter(row => row[0] === 'konstantin').length, 1);
  coaches.rows = [coaches.rows[0]];
  assert.deepEqual(h.get().coaches, []);
});

test('upgrading the old sheet preserves applications and edits while adding coach columns and migrating only legacy defaults', () => {
  const h = harness();
  h.post(registration());
  const applications = h.sheets.get('Заявки');
  applications.rows = applications.rows.map(row => row.slice(0, 13));
  const oldApplication = [...applications.rows[1]];
  h.sheets.delete('Тренеры');
  const settings = h.sheets.get('Настройки');
  settings.rows.find(row => row[0] === 'brandName')[1] = 'В потоке';
  settings.rows.find(row => row[0] === 'heroTitle')[1] = 'Плавать легче, чем кажется.';
  settings.rows.find(row => row[0] === 'heroDescription')[1] = 'Текст менеджера';
  settings.rows.find(row => row[0] === 'location')[1] = 'Петропавловск, адрес бассейна от менеджера';
  h.context.setup();
  assert.deepEqual(applications.rows[0].slice(13), ['coachId', 'coachName']);
  assert.deepEqual(applications.rows[1], oldApplication);
  assert.equal(h.get().settings.brandName, 'SPARTAN SWIM');
  assert.equal(h.get().settings.heroTitle, 'Характер рождается в воде.');
  assert.equal(h.get().settings.heroDescription, 'Текст менеджера');
  assert.equal(h.get().settings.location, 'Петропавловск, адрес бассейна от менеджера');
  assert.equal(h.get().coaches.length, 4);
  const scheduleBefore = JSON.stringify(h.sheets.get('Расписание').rows);
  const coachesBefore = JSON.stringify(h.sheets.get('Тренеры').rows);
  for (const previousDescription of ['Плавание для детей и взрослых в Астане.', 'Школа плавания для детей и взрослых в Астане. От первого вдоха до уверенной техники.']) {
    settings.rows.find(row => row[0] === 'location')[1] = 'Астана';
    settings.rows.find(row => row[0] === 'heroDescription')[1] = previousDescription;
    h.context.setup();
    h.context.setup();
    assert.equal(h.get().settings.location, 'Кокшетау');
    assert.equal(h.get().settings.heroDescription, 'Школа плавания для детей и взрослых в Кокшетау. От первого вдоха до уверенной техники.');
    assert.deepEqual(applications.rows[1], oldApplication);
    assert.equal(JSON.stringify(h.sheets.get('Расписание').rows), scheduleBefore);
    assert.equal(JSON.stringify(h.sheets.get('Тренеры').rows), coachesBefore);
  }
  assert.equal(h.post(registration()).duplicate, true);
  assert.equal(h.messages.length, 1);
  assert.equal(h.triggers.length, 1);
});

test('setup does not overwrite a manager column occupying the new coach columns', () => {
  const h = harness();
  const sheet = h.sheets.get('Заявки');
  sheet.rows[0][13] = 'Заметки менеджера';
  sheet.rows.push(Array.from({ length: 14 }, (_, index) => index === 13 ? 'Сохранить эту заметку' : ''));
  assert.throws(() => h.context.setup(), /Сохраните свои дополнительные столбцы/);
  assert.equal(sheet.rows[0][13], 'Заметки менеджера');
  assert.equal(sheet.rows[1][13], 'Сохранить эту заметку');
});

test('setup corrects only the old Erik surname and preserves manager edits and past bookings', () => {
  const h = harness();
  const coaches = h.sheets.get('Тренеры');
  const erik = coaches.rows.find(row => row[0] === 'erik');
  erik[1] = 'Рускулов Эрик Рустамович';
  assert.equal(h.post(registration({ coachId: 'erik' })).ok, true);
  const oldBooking = [...h.sheets.get('Заявки').rows[1]];
  erik[2] = 'Роль от менеджера';
  erik[3] = 'https://example.com/erik.jpg';
  erik[5] = false;
  const other = coaches.rows.find(row => row[0] === 'konstantin');
  other[1] = 'Рускулов Эрик Рустамович';
  const otherBefore = [...other];
  h.context.setup();
  h.context.setup();
  assert.deepEqual(erik, ['erik', 'Раскулов Эрик Рустамович', 'Роль от менеджера', 'https://example.com/erik.jpg', false, false]);
  assert.deepEqual(other, otherBefore);
  assert.deepEqual(h.sheets.get('Заявки').rows[1], oldBooking);
  erik[1] = 'Эрик — имя от менеджера';
  h.context.setup();
  assert.equal(erik[1], 'Эрик — имя от менеджера');
  assert.equal(h.triggers.length, 1);
});
