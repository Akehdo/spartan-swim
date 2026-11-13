/**
 * Spartan Swim: Google Sheets + Telegram, без отдельной базы данных.
 * Установка: docs/INTEGRATION.md. Никогда не помещайте токен бота в сайт.
 */
var SHEETS = { settings: 'Настройки', schedule: 'Расписание', coaches: 'Тренеры', registrations: 'Заявки' };
var SCHEDULE_HEADERS = ['id', 'audience', 'days', 'start', 'end', 'level', 'active'];
var COACH_HEADERS = ['id', 'name', 'role', 'image', 'senior', 'active'];
var REGISTRATION_HEADERS = ['createdAt', 'requestId', 'registrationId', 'name', 'phone', 'participantName', 'age', 'experience', 'groupId', 'groupDescription', 'consent', 'telegramStatus', 'telegramAttempts', 'coachId', 'coachName'];
var PUBLIC_SETTING_KEYS = ['brandName', 'coachName', 'heroTitle', 'heroDescription', 'childrenTitle', 'childrenDescription', 'adultsTitle', 'adultsDescription', 'coachIntro', 'location', 'phone', 'whatsapp', 'instagram', 'childrenPrice', 'adultsPrice', 'contactNote'];
var VALID_DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

/** Запустить один раз вручную в проекте, привязанном к Google Таблице. */
function setup() {
  var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  if (!spreadsheet) throw new Error('Откройте Apps Script через Расширения → Apps Script в Google Таблице.');
  PropertiesService.getScriptProperties().setProperty('SPREADSHEET_ID', spreadsheet.getId());
  var defaultSettings = [
    ['brandName', 'SPARTAN SWIM'], ['coachName', 'Медхат Даиров'],
    ['heroTitle', 'Характер рождается в воде.'],
    ['heroDescription', 'Школа плавания для детей и взрослых в Астане. От первого вдоха до уверенной техники.'],
    ['childrenTitle', 'Уверенность в воде.'],
    ['childrenDescription', 'Знакомимся с водой, учимся дышать и осваиваем технику.'],
    ['adultsTitle', 'Свобода движения.'],
    ['adultsDescription', 'Учимся плавать с нуля или совершенствуем технику.'],
    ['coachIntro', 'Старший тренер Spartan Swim. Поможет подобрать тренера и группу по вашему уровню.'],
    ['location', 'Астана'], ['phone', '+7 707 620 4904'], ['whatsapp', '77076204904'],
    ['instagram', 'https://www.instagram.com/p/DPTBBraiJYW/'],
    ['childrenPrice', ''], ['adultsPrice', ''], ['contactNote', '']
  ];
  var settings = ensureSheet_(spreadsheet, SHEETS.settings, ['key', 'value'], defaultSettings);
  var existingKeys = settings.getLastRow() > 1 ? settings.getRange(2, 1, settings.getLastRow() - 1, 1).getDisplayValues().map(function (row) { return row[0]; }) : [];
  defaultSettings.forEach(function (row) {
    // Новые редактируемые тексты добавляются и в ранее настроенную таблицу.
    if (existingKeys.indexOf(row[0]) === -1) settings.appendRow(row);
  });
  migrateSettings_(settings, defaultSettings);
  var schedule = ensureSheet_(spreadsheet, SHEETS.schedule, SCHEDULE_HEADERS, defaultSchedule_().map(function (group) {
    return [group.id, group.audience, group.days.join(','), group.start, group.end, group.level, true];
  }));
  // Храним часы текстом: Google Таблицы не должны превращать их в даты.
  schedule.getRange(2, 4, Math.max(schedule.getLastRow() - 1, 1), 2).setNumberFormat('@');
  ensureSheet_(spreadsheet, SHEETS.coaches, COACH_HEADERS, defaultCoaches_().map(function (coach) {
    return [coach.id, coach.name, coach.role, coach.image, coach.senior, coach.active];
  }));
  var registrations = ensureSheet_(spreadsheet, SHEETS.registrations, REGISTRATION_HEADERS, []);
  ensureRegistrationHeaders_(registrations);
  installNotificationRetry();
}

/** Установка повторной доставки. Не создаёт дубликаты триггеров. */
function installNotificationRetry() {
  var exists = ScriptApp.getProjectTriggers().some(function (trigger) {
    return trigger.getHandlerFunction() === 'retryFailedNotifications';
  });
  if (!exists) ScriptApp.newTrigger('retryFailedNotifications').timeBased().everyMinutes(5).create();
}

function doGet(event) {
  try {
    if (!event || !event.parameter || event.parameter.action !== 'bootstrap') {
      return json_({ ok: false, error: { code: 'NOT_FOUND', message: 'Неизвестный запрос.' } });
    }
    var spreadsheet = getSpreadsheet_();
    return json_({ ok: true, settings: readSettings_(spreadsheet), schedule: readSchedule_(spreadsheet), coaches: readCoaches_(spreadsheet) });
  } catch (error) {
    return errorResponse_(error);
  }
}

function doPost(event) {
  try {
    var contents = event && event.postData && event.postData.contents;
    if (!contents || contents.length > 6000) fail_('INVALID_REQUEST', 'Проверьте данные заявки.');
    var input;
    try { input = JSON.parse(contents); } catch (error) { fail_('INVALID_REQUEST', 'Некорректный формат заявки.'); }
    if (!input || input.action !== 'register') fail_('INVALID_REQUEST', 'Неизвестный запрос.');
    return json_(register_(input));
  } catch (error) {
    return errorResponse_(error);
  }
}

function register_(input) {
  var data = validateRegistration_(input);
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) fail_('BUSY', 'Сейчас поступает много заявок. Попробуйте ещё раз через минуту.');
  var sheet;
  var rowNumber;
  var registrationId;
  try {
    var spreadsheet = getSpreadsheet_();
    sheet = spreadsheet.getSheetByName(SHEETS.registrations);
    if (!sheet) fail_('NOT_CONFIGURED', 'Запись пока недоступна. Свяжитесь с тренером.');
    var existing = findRequest_(sheet, data.requestId);
    if (existing) {
      return { ok: true, registrationId: existing.values[2], notificationSent: existing.values[11] === 'sent', duplicate: true };
    }
    var group = readSchedule_(spreadsheet).filter(function (item) { return item.id === data.groupId; })[0];
    if (!group || !group.active) fail_('GROUP_UNAVAILABLE', 'Эта группа больше недоступна. Выберите другое время.');
    if (group.level === 'master') fail_('MASTER_CLOSED', 'В группу «Мастер» нет набора новичков. Выберите другую группу.');
    var coach = data.coachId ? readCoaches_(spreadsheet).filter(function (item) { return item.id === data.coachId && item.active; })[0] : null;
    if (data.coachId && !coach) fail_('COACH_UNAVAILABLE', 'Этот тренер сейчас недоступен для записи. Выберите другого тренера или оставьте выбор за нами.');
    if (group.audience === 'children' && (!data.participantName || data.age === '')) {
      fail_('CHILD_DETAILS_REQUIRED', 'Укажите имя и возраст ребёнка.');
    }
    if (group.audience === 'children' && (data.age < 1 || data.age > 17)) {
      fail_('INVALID_AGE', 'Укажите возраст ребёнка от 1 до 17 лет.');
    }
    throttle_(data.phone);
    registrationId = Utilities.getUuid();
    var description = describeGroup_(group);
    sheet.appendRow([
      new Date().toISOString(), data.requestId, registrationId,
      safeCell_(data.name), safeCell_(data.phone), safeCell_(data.participantName), data.age,
      data.experience, safeCell_(group.id), description, true, 'pending', 0,
      coach ? safeCell_(coach.id) : '', coach ? safeCell_(coach.name) : ''
    ]);
    SpreadsheetApp.flush();
    rowNumber = sheet.getLastRow();
  } finally {
    lock.releaseLock();
  }
  // Заявка уже сохранена; сбой Telegram не должен заставлять посетителя отправлять её повторно.
  var sent = deliverNotification_(sheet, rowNumber);
  return { ok: true, registrationId: registrationId, notificationSent: sent };
}

function validateRegistration_(input) {
  if (input.website) fail_('INVALID_REQUEST', 'Не удалось отправить заявку.');
  if (input.consent !== true) fail_('CONSENT_REQUIRED', 'Нужно согласие на обработку данных заявки.');
  var name = cleanText_(input.name, 100);
  var phone = cleanText_(input.phone, 40);
  var participantName = cleanText_(input.participantName || '', 100);
  var groupId = cleanText_(input.groupId, 100);
  var requestId = cleanText_(input.requestId, 80);
  var coachId = input.coachId === undefined || input.coachId === null ? '' : cleanText_(input.coachId, 80);
  if (coachId && !/^[a-zA-Z0-9_-]{1,80}$/.test(coachId)) fail_('INVALID_COACH', 'Выберите тренера из списка.');
  if (name.length < 2) fail_('INVALID_NAME', 'Укажите ваше имя.');
  if (!/^[+\d\s()\-]+$/.test(phone) || phone.replace(/\D/g, '').length < 10 || phone.replace(/\D/g, '').length > 15) {
    fail_('INVALID_PHONE', 'Проверьте номер телефона: от 10 до 15 цифр.');
  }
  if (!/^[a-zA-Z0-9_-]{8,80}$/.test(requestId)) fail_('INVALID_REQUEST', 'Обновите страницу и попробуйте снова.');
  if (input.experience !== 'beginner' && input.experience !== 'confident') fail_('INVALID_EXPERIENCE', 'Выберите уровень подготовки.');
  var age = input.age === '' || input.age === undefined || input.age === null ? '' : Number(input.age);
  if (age !== '' && (!Number.isInteger(age) || age < 1 || age > 100)) fail_('INVALID_AGE', 'Проверьте возраст участника.');
  return { name: name, phone: phone, participantName: participantName, groupId: groupId, requestId: requestId, experience: input.experience, age: age, coachId: coachId };
}

function defaultCoaches_() {
  return [
    { id: 'medhat', name: 'Медхат Даиров', role: 'Старший тренер', image: '/images/medhat-coach.jpg', senior: true, active: true },
    { id: 'erik', name: 'Рускулов Эрик Рустамович', role: 'Тренер по плаванию', image: '/images/coach-erik.png', senior: false, active: true },
    { id: 'konstantin', name: 'Романенко Константин Максимович', role: 'Тренер по плаванию', image: '/images/coach-konstantin.png', senior: false, active: true },
    { id: 'andrey', name: 'Беляков Андрей Андреевич', role: 'Тренер по плаванию', image: '/images/coach-andrey.png', senior: false, active: true }
  ];
}

function readCoaches_(spreadsheet) {
  var sheet = spreadsheet.getSheetByName(SHEETS.coaches);
  // При обновлении кода старые заявки работают и до первого запуска setup().
  if (!sheet) return defaultCoaches_();
  if (sheet.getLastRow() < 2) return [];
  var seen = {};
  return sheet.getRange(2, 1, sheet.getLastRow() - 1, COACH_HEADERS.length).getDisplayValues().map(function (row) {
    return { id: String(row[0]).trim(), name: String(row[1]).trim(), role: String(row[2]).trim(), image: String(row[3]).trim(),
      senior: /^(true|1|да)$/i.test(String(row[4]).trim()), active: /^(true|1|да)$/i.test(String(row[5]).trim()) };
  }).filter(function (coach) {
    var valid = /^[a-zA-Z0-9_-]{1,80}$/.test(coach.id) && !seen[coach.id] && coach.name.length >= 2 && coach.name.length <= 100 &&
      coach.role.length > 0 && coach.role.length <= 100 && coach.image.length <= 2000 &&
      (/^\/images\/[a-zA-Z0-9_-]+\.(?:png|jpe?g|webp|avif)$/i.test(coach.image) || /^https:\/\/[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?(?::[0-9]{1,5})?(?:[/?#][^\s]*)?$/.test(coach.image));
    if (valid) seen[coach.id] = true;
    return Boolean(valid);
  });
}

/** Меняем только прежние исходные тексты; собственные правки менеджера сохраняются. */
function migrateSettings_(sheet, defaults) {
  var legacy = { brandName: 'В потоке', heroTitle: 'Плавать легче, чем кажется.',
    heroDescription: 'Плавание для детей и взрослых в Астане.', coachIntro: 'Тренер по плаванию. Помогу плавать увереннее.' };
  var next = {};
  defaults.forEach(function (row) { next[row[0]] = row[1]; });
  var rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, 2).getDisplayValues();
  rows.forEach(function (row, index) {
    if (Object.prototype.hasOwnProperty.call(legacy, row[0]) && row[1] === legacy[row[0]]) sheet.getRange(index + 2, 2).setValue(next[row[0]]);
  });
}

/** Добавляем два столбца к прежним 13, не затрагивая сохранённые заявки. */
function ensureRegistrationHeaders_(sheet) {
  var headers = sheet.getRange(1, 1, 1, REGISTRATION_HEADERS.length).getDisplayValues()[0];
  for (var index = 0; index < REGISTRATION_HEADERS.length; index++) {
    if (headers[index] && headers[index] !== REGISTRATION_HEADERS[index]) {
      throw new Error('Лист «Заявки»: столбец ' + (index + 1) + ' должен называться «' + REGISTRATION_HEADERS[index] + '». Сохраните свои дополнительные столбцы правее coachName и повторите setup().');
    }
    if (!headers[index]) sheet.getRange(1, index + 1).setValue(REGISTRATION_HEADERS[index]);
  }
}

function readSettings_(spreadsheet) {
  var sheet = spreadsheet.getSheetByName(SHEETS.settings);
  var settings = {};
  if (!sheet || sheet.getLastRow() < 2) return settings;
  sheet.getRange(2, 1, sheet.getLastRow() - 1, 2).getDisplayValues().forEach(function (row) {
    if (PUBLIC_SETTING_KEYS.indexOf(row[0]) !== -1) settings[row[0]] = row[1].slice(0, 2000);
  });
  return settings;
}

function readSchedule_(spreadsheet) {
  var sheet = spreadsheet.getSheetByName(SHEETS.schedule);
  if (!sheet) fail_('NOT_CONFIGURED', 'Расписание временно недоступно.');
  if (sheet.getLastRow() < 2) return [];
  var seen = {};
  return sheet.getRange(2, 1, sheet.getLastRow() - 1, SCHEDULE_HEADERS.length).getDisplayValues().map(function (row) {
    var days = String(row[2]).toLowerCase().split(/[\s,;]+/).filter(Boolean);
    return {
      id: String(row[0]).trim(), audience: String(row[1]).trim().toLowerCase(), days: days,
      start: normalizeTime_(row[3]), end: normalizeTime_(row[4]), level: String(row[5]).trim().toLowerCase(),
      active: /^(true|1|да)$/i.test(String(row[6]).trim())
    };
  }).filter(function (group) {
    var valid = /^[a-zA-Z0-9_-]{1,100}$/.test(group.id) && !seen[group.id] &&
      ['children', 'adults'].indexOf(group.audience) !== -1 &&
      group.days.length > 0 && group.days.every(function (day) { return VALID_DAYS.indexOf(day) !== -1; }) &&
      group.start && group.end && group.start < group.end && ['all', 'master'].indexOf(group.level) !== -1;
    if (valid) seen[group.id] = true;
    return Boolean(valid);
  });
}

function normalizeTime_(value) {
  var match = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(String(value).trim());
  if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) return '';
  return ('0' + match[1]).slice(-2) + ':' + match[2];
}

function defaultSchedule_() {
  var schedule = [];
  function add(audience, code, days, times, masters) {
    times.forEach(function (hour) {
      var start = ('0' + hour).slice(-2) + ':00';
      schedule.push({ id: audience + '-' + code + '-' + start.replace(':', ''), audience: audience, days: days,
        start: start, end: ('0' + (hour + 1)).slice(-2) + ':00', level: masters.indexOf(hour) !== -1 ? 'master' : 'all', active: true });
    });
  }
  add('children', 'mwf', ['mon', 'wed', 'fri'], [8, 15, 19, 20], []);
  add('children', 'tts', ['tue', 'thu', 'sat'], [8, 16, 19, 20], []);
  add('adults', 'mwf', ['mon', 'wed', 'fri'], [8, 12, 13, 19, 21], [13, 19]);
  add('adults', 'tt', ['tue', 'thu'], [8, 12], []);
  return schedule;
}

function describeGroup_(group) {
  var labels = { mon: 'ПН', tue: 'ВТ', wed: 'СР', thu: 'ЧТ', fri: 'ПТ', sat: 'СБ', sun: 'ВС' };
  return (group.audience === 'children' ? 'Дети' : 'Взрослые') + ' · ' + group.days.map(function (day) { return labels[day]; }).join(' ') + ' · ' + group.start + '–' + group.end;
}

function findRequest_(sheet, requestId) {
  if (sheet.getLastRow() < 2) return null;
  var ids = sheet.getRange(2, 2, sheet.getLastRow() - 1, 1).getValues();
  for (var index = 0; index < ids.length; index++) {
    if (ids[index][0] === requestId) return { row: index + 2, values: sheet.getRange(index + 2, 1, 1, REGISTRATION_HEADERS.length).getValues()[0] };
  }
  return null;
}

function throttle_(phone) {
  var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, phone.replace(/\D/g, ''));
  var key = 'registration:' + Utilities.base64EncodeWebSafe(digest);
  var cache = CacheService.getScriptCache();
  var count = Number(cache.get(key) || 0);
  if (count >= 6) fail_('RATE_LIMIT', 'Вы уже отправили несколько заявок. Пожалуйста, подождите или свяжитесь с тренером.');
  cache.put(key, String(count + 1), 3600);
}

function deliverNotification_(sheet, rowNumber) {
  // Один lock для отправки и фоновых повторов исключает два уведомления об одной заявке.
  var lock;
  var acquired = false;
  var sent = false;
  try {
    lock = LockService.getScriptLock();
    acquired = lock.tryLock(10000);
    if (acquired) sent = sendNotificationLocked_(sheet, rowNumber);
  } catch (error) {
    // Заявка уже подтверждённо сохранена. Сбой доставки не меняет результат записи.
    sent = false;
  } finally {
    if (acquired) {
      try {
        // Фиксируем статус и число попыток, пока другие отправки ещё заблокированы.
        SpreadsheetApp.flush();
      } catch (error) {
        sent = false;
      } finally {
        try { lock.releaseLock(); } catch (error) { sent = false; }
      }
    }
  }
  return sent;
}

function sendNotificationLocked_(sheet, rowNumber) {
    var row = sheet.getRange(rowNumber, 1, 1, REGISTRATION_HEADERS.length).getValues()[0];
    if (row[11] === 'sent') return true;
    var attempts = Number(row[12] || 0);
    var properties = PropertiesService.getScriptProperties();
    var token = properties.getProperty('TELEGRAM_BOT_TOKEN');
    var chatId = properties.getProperty('TELEGRAM_CHAT_ID');
    if (!token || !chatId) {
      sheet.getRange(rowNumber, 12).setValue('not_configured');
      return false;
    }
    if (attempts >= 5) return false;
    sheet.getRange(rowNumber, 13).setValue(attempts + 1);
    var text = '🏊 Новая заявка · SPARTAN SWIM\n\n' +
      'Контакт: ' + plainCell_(row[3]) + '\n' +
      'Телефон: ' + plainCell_(row[4]) + '\n' +
      'WhatsApp: https://wa.me/' + plainCell_(row[4]).replace(/\D/g, '') + '\n' +
      (row[5] ? 'Участник: ' + plainCell_(row[5]) + (row[6] !== '' ? ' · ' + row[6] + ' лет' : '') + '\n' : '') +
      'Уровень: ' + (row[7] === 'beginner' ? 'Начинающий' : 'Уверенно держится на воде') + '\n' +
      'Группа: ' + row[9] + '\n' +
      'Тренер: ' + (row[14] ? plainCell_(row[14]) + ' (предпочтение)' : 'Помочь с выбором');
    var sent = false;
    try {
      var response = UrlFetchApp.fetch('https://api.telegram.org/bot' + token + '/sendMessage', {
        method: 'post', contentType: 'application/json',
        payload: JSON.stringify({ chat_id: chatId, text: text, link_preview_options: { is_disabled: true } }),
        muteHttpExceptions: true
      });
      var body = JSON.parse(response.getContentText());
      sent = response.getResponseCode() === 200 && body.ok === true;
    } catch (error) {
      // Не логируем URL запроса, токен, текст и персональные данные.
      sent = false;
    }
    sheet.getRange(rowNumber, 12).setValue(sent ? 'sent' : 'error');
    return sent;
}

/** Триггер раз в 5 минут; можно запустить вручную. Максимум 10 доставок за запуск. */
function retryFailedNotifications() {
  var sheet = getSpreadsheet_().getSheetByName(SHEETS.registrations);
  if (!sheet || sheet.getLastRow() < 2) return;
  var rows = sheet.getRange(2, 12, sheet.getLastRow() - 1, 2).getValues();
  var attempted = 0;
  rows.forEach(function (row, index) {
    if (attempted < 10 && row[0] !== 'sent' && Number(row[1] || 0) < 5) {
      attempted++;
      deliverNotification_(sheet, index + 2);
    }
  });
}

function ensureSheet_(spreadsheet, name, headers, rows) {
  var sheet = spreadsheet.getSheetByName(name) || spreadsheet.insertSheet(name);
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    if (rows.length) {
      sheet.getRange(2, 1, rows.length, headers.length).setNumberFormat('@');
      sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
    }
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#d9eee7');
    sheet.autoResizeColumns(1, headers.length);
  }
  return sheet;
}

function getSpreadsheet_() {
  var id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  if (!id) fail_('NOT_CONFIGURED', 'Запись пока недоступна. Свяжитесь с тренером.');
  return SpreadsheetApp.openById(id);
}

function cleanText_(value, maxLength) {
  if (typeof value !== 'string' || value.length > maxLength) fail_('INVALID_REQUEST', 'Проверьте заполненные поля.');
  return value.replace(/[\u0000-\u001F\u007F]/g, ' ').trim();
}

function safeCell_(value) {
  var text = String(value);
  return /^[\s]*[=+\-@]/.test(text) ? "'" + text : text;
}

function plainCell_(value) {
  return String(value).replace(/^'(?=[\s]*[=+\-@])/, '');
}

function fail_(code, message) {
  var error = new Error(message);
  error.publicCode = code;
  throw error;
}

function errorResponse_(error) {
  return json_({ ok: false, error: {
    code: error.publicCode || 'SERVER_ERROR',
    message: error.publicCode ? error.message : 'Не удалось обработать заявку. Попробуйте позже или свяжитесь с тренером.'
  } });
}

function json_(value) {
  return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);
}
