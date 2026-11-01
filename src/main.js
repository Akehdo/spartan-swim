import { defaultSettings, defaultSchedule, dayLabels, dayNames, availableGroups, groupLabel, normalizeSchedule } from './data.js';
import { apiRequest, validEndpoint } from './api.js';
import { initMotion } from './motion.js';

const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const state = { settings: { ...defaultSettings }, schedule: defaultSchedule, audience: 'children', endpoint: '', busy: false, requestId: '', fingerprint: '', hasSucceeded: false };
const booking = $('#booking-dialog');
const form = $('#booking-form');
const submit = $('#booking-submit');
const submitLabel = 'Отправить заявку';
let motion;

function icon(id, className = 'icon') {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.classList.add(className);
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', `#i-${id}`);
  svg.append(use);
  return svg;
}

function make(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}

function whatsappUrl(text) {
  const digits = String(state.settings.whatsapp || state.settings.phone).replace(/\D/g, '');
  const url = new URL(`https://wa.me/${/^\d{10,15}$/.test(digits) ? digits : '77076204904'}`);
  if (text) url.searchParams.set('text', text);
  return url.href;
}

function applySettings(input) {
  const safe = {};
  for (const key of Object.keys(defaultSettings)) {
    if (typeof input?.[key] === 'string' && input[key].length <= 2000) safe[key] = input[key];
  }
  state.settings = { ...defaultSettings, ...safe };
  for (const key of ['brandName', 'coachName', 'heroTitle', 'heroDescription', 'phone', 'location']) {
    if (!state.settings[key].trim()) state.settings[key] = defaultSettings[key];
  }
  $$('[data-setting]').forEach(el => {
    if (state.settings[el.dataset.setting]) el.textContent = state.settings[el.dataset.setting];
  });
  const heading = $('#hero-title');
  const title = state.settings.heroTitle;
  const comma = title.indexOf(',');
  heading.replaceChildren();
  if (comma > 0 && comma < title.length - 1) {
    heading.append(document.createTextNode(title.slice(0, comma + 1)), document.createElement('br'), make('em', '', title.slice(comma + 1).trim()));
  } else heading.textContent = title;
  // Long custom headlines wrap naturally instead of overflowing the layout.
  heading.style.whiteSpace = title.length > 45 ? 'normal' : '';
  const firstName = state.settings.coachName.trim().split(/\s+/)[0];
  $$('[data-coach-firstname]').forEach(el => { el.textContent = firstName; });
  const city = state.settings.location.trim();
  $$('[data-city-case]').forEach(el => { el.textContent = city.toLowerCase() === 'астана' ? 'Астане' : city; });
  const digits = state.settings.phone.replace(/\D/g, '');
  $$('[data-phone]').forEach(el => { el.href = `tel:+${digits || '77076204904'}`; });
  $$('[data-whatsapp]').forEach(el => { el.href = whatsappUrl(); });
  try {
    const instagram = new URL(state.settings.instagram);
    if (instagram.protocol === 'https:' && /^(www\.)?instagram\.com$/.test(instagram.hostname)) {
      $$('[data-instagram]').forEach(el => { el.href = instagram.href; });
    }
  } catch { /* Keep the supplied Instagram post when the edited value is invalid. */ }
  $('.coach-intro').textContent = state.settings.coachIntro;
  const note = $('#contact-note');
  note.textContent = state.settings.contactNote;
  note.hidden = !state.settings.contactNote;
  document.title = `${state.settings.brandName} — ${state.settings.coachName} · плавание в Астане`;
  motion?.refresh();
}

function renderSchedule() {
  const panel = $('#schedule-panel');
  panel.setAttribute('aria-labelledby', `tab-${state.audience}`);
  panel.replaceChildren();
  const visible = state.schedule.filter(group => group.audience === state.audience);
  const dayGroups = new Map();
  for (const group of visible) {
    const key = group.days.join(',');
    if (!dayGroups.has(key)) dayGroups.set(key, []);
    dayGroups.get(key).push(group);
  }
  if (!dayGroups.size) panel.append(make('p', 'empty-schedule', 'Новые группы скоро появятся. Напишите тренеру, чтобы подобрать время.'));
  for (const groups of dayGroups.values()) {
    const card = make('article', 'schedule-card');
    const header = make('div', 'schedule-card-header');
    const days = make('h3', 'day-chip-group');
    days.setAttribute('aria-label', groups[0].days.map(day => dayNames[day]).join(', '));
    groups[0].days.forEach(day => days.append(make('span', 'day-chip', dayLabels[day])));
    header.append(days);
    const slots = make('div', 'schedule-slots');
    for (const group of groups.toSorted((a, b) => a.start.localeCompare(b.start))) {
      const isMaster = group.level === 'master';
      const button = make('button', 'time-slot');
      button.type = 'button';
      button.disabled = isMaster || !group.active;
      button.setAttribute('aria-label', `${groupLabel(group)}${isMaster ? ', Мастер — набор новичков закрыт' : !group.active ? ', набор закрыт' : ', записаться'}`);
      const time = make('span', 'slot-time');
      time.append(document.createTextNode(group.start), make('span', 'time-dash', '—'), document.createTextNode(group.end));
      const meta = make('span', 'slot-meta');
      if (isMaster) {
        meta.append(make('span', 'master-badge', 'МАСТЕР'), icon('lock'));
        button.title = 'Действующая группа. Набор новичков не ведётся.';
      } else if (!group.active) meta.append(make('span', '', 'Набор закрыт'), icon('lock'));
      else {
        meta.append(icon('diagonal'));
        button.addEventListener('click', () => openBooking(state.audience, group.id));
      }
      button.append(time, meta);
      slots.append(button);
    }
    card.append(header, slots);
    panel.append(card);
  }
  motion?.refresh(panel);
}

function setAudience(audience, focusTab = false) {
  state.audience = audience;
  $$('[data-audience]').forEach(tab => {
    const active = tab.dataset.audience === audience;
    tab.setAttribute('aria-selected', String(active));
    tab.tabIndex = active ? 0 : -1;
    if (active && focusTab) tab.focus();
  });
  renderSchedule();
}

function updateFormAudience(audience, groupId = '') {
  form.elements.audience.value = audience;
  $('#name-label').textContent = audience === 'children' ? 'Имя родителя' : 'Ваше имя';
  $('#child-fields').hidden = audience !== 'children';
  for (const name of ['participantName', 'age']) {
    form.elements[name].required = audience === 'children';
    form.elements[name].disabled = audience !== 'children';
  }
  const experienceOptions = $('#booking-experience').options;
  experienceOptions[0].textContent = audience === 'children' ? 'Начинаем с нуля' : 'Начинаю с нуля';
  const select = $('#booking-group');
  select.replaceChildren();
  const empty = make('option', '', 'Выберите время');
  empty.value = '';
  empty.disabled = true;
  select.append(empty);
  availableGroups(state.schedule, audience).forEach(group => {
    const option = make('option', '', groupLabel(group));
    option.value = group.id;
    select.append(option);
  });
  select.value = [...select.options].some(option => option.value === groupId) ? groupId : '';
}

function showMessage(text) {
  const el = $('#form-message');
  el.textContent = text;
  el.hidden = !text;
}

function restoreWhatsapp() {
  const link = $('#form-whatsapp');
  link.className = 'form-whatsapp';
  link.replaceChildren(icon('chat'), document.createTextNode(' Или написать в WhatsApp'));
  link.href = whatsappUrl();
}

function openBooking(audience = state.audience, groupId = '') {
  if (state.busy) {
    if (!booking.open) booking.showModal();
    document.body.classList.add('dialog-open');
    return;
  }
  if (state.hasSucceeded) {
    form.reset();
    state.hasSucceeded = false;
    state.requestId = '';
    state.fingerprint = '';
  }
  $('#booking-content').hidden = false;
  $('#booking-success').hidden = true;
  updateFormAudience(audience || state.audience, groupId);
  showMessage('');
  restoreWhatsapp();
  closeMenu();
  booking.showModal();
  document.body.classList.add('dialog-open');
  requestAnimationFrame(() => $('#booking-name').focus({ preventScroll: true }));
}

function closeMenu() {
  $('#mobile-nav').hidden = true;
  $('#menu-toggle').setAttribute('aria-expanded', 'false');
  $('#menu-toggle').setAttribute('aria-label', 'Открыть меню');
}

$$('[data-book]').forEach(button => button.addEventListener('click', () => openBooking(button.dataset.book || state.audience)));
$$('[data-audience]').forEach(tab => {
  tab.addEventListener('click', () => setAudience(tab.dataset.audience));
  tab.addEventListener('keydown', event => {
    if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      setAudience(event.key === 'Home' ? 'children' : event.key === 'End' ? 'adults' : state.audience === 'children' ? 'adults' : 'children', true);
    }
  });
});
form.elements.audience.forEach(input => input.addEventListener('change', () => { updateFormAudience(input.value); showMessage(''); restoreWhatsapp(); }));
form.addEventListener('input', () => {
  if (!state.busy) { showMessage(''); restoreWhatsapp(); }
});
$('#booking-phone').addEventListener('input', event => {
  const digits = event.target.value.replace(/\D/g, '');
  event.target.setCustomValidity(/^[+\d\s()\-]+$/.test(event.target.value) && digits.length >= 10 && digits.length <= 15 ? '' : 'Укажите номер телефона с кодом страны, например +7 707 620 4904.');
});

function whatsappMessage(payload, audience, group) {
  return [
    'Здравствуйте, Медхат! Хочу записаться на плавание.',
    `Занятие: ${audience === 'children' ? 'для ребёнка' : 'для взрослого'}`,
    `Имя${audience === 'children' ? ' родителя' : ''}: ${payload.name}`,
    `Телефон: ${payload.phone}`,
    ...(audience === 'children' ? [`Ребёнок: ${payload.participantName}, возраст: ${payload.age}`] : []),
    `Опыт: ${payload.experience === 'beginner' ? 'с нуля' : 'есть опыт'}`,
    `Группа: ${groupLabel(group)}`,
  ].join('\n');
}

form.addEventListener('submit', async event => {
  event.preventDefault();
  if (state.busy || !form.reportValidity()) return;
  const data = new FormData(form);
  const audience = data.get('audience');
  const group = availableGroups(state.schedule, audience).find(group => group.id === data.get('groupId'));
  if (!group) { showMessage('Выберите доступную группу. В группы «Мастер» набор не ведётся.'); return; }
  const payload = {
    action: 'register', groupId: group.id,
    name: String(data.get('name')).trim(),
    phone: String(data.get('phone')).trim(),
    participantName: audience === 'children' ? String(data.get('participantName')).trim() : String(data.get('name')).trim(),
    age: audience === 'children' ? Number(data.get('age')) : '',
    experience: data.get('experience'), consent: data.get('consent') === 'on',
    website: String(data.get('website') || ''),
  };
  if (payload.name.length < 2 || (audience === 'children' && payload.participantName.length < 2)) {
    showMessage('Укажите имя — минимум два символа.'); return;
  }
  const text = whatsappMessage(payload, audience, group);
  $('#form-whatsapp').href = whatsappUrl(text);
  if (!state.endpoint) {
    showMessage('Заявка заполнена. Отправьте её тренеру в WhatsApp, чтобы согласовать занятие.');
    const link = $('#form-whatsapp');
    link.className = 'button button-lime form-whatsapp';
    link.replaceChildren(icon('chat'), document.createTextNode('Отправить заявку в WhatsApp'));
    link.focus();
    return;
  }
  const fingerprint = JSON.stringify(payload);
  if (state.fingerprint !== fingerprint) {
    state.requestId = crypto.randomUUID();
    state.fingerprint = fingerprint;
  }
  payload.requestId = state.requestId;
  state.busy = true;
  submit.disabled = true;
  submit.setAttribute('aria-busy', 'true');
  submit.textContent = 'Отправляем заявку…';
  form.setAttribute('aria-busy', 'true');
  // Keep the submitted snapshot stable while the network request is in flight.
  [...form.elements].forEach(el => { if (el !== submit) el.disabled = true; });
  showMessage('');
  try {
    await apiRequest(state.endpoint, payload, { method: 'POST', signal: AbortSignal.timeout(35000) });
    state.hasSucceeded = true;
    $('#booking-content').hidden = true;
    $('#booking-success').hidden = false;
    $('#booking-success [data-close]').focus();
  } catch (error) {
    showMessage(error.name === 'TimeoutError' || error.name === 'AbortError'
      ? 'Ответ задерживается. Попробуйте ещё раз: повторная заявка не создаст дубликат. Также можно написать тренеру в WhatsApp.'
      : error instanceof TypeError ? 'Не удалось связаться с сервисом. Проверьте интернет и повторите отправку или напишите в WhatsApp.' : error.message);
  } finally {
    state.busy = false;
    [...form.elements].forEach(el => { el.disabled = false; });
    for (const name of ['participantName', 'age']) form.elements[name].disabled = audience !== 'children';
    submit.removeAttribute('aria-busy');
    form.removeAttribute('aria-busy');
    submit.replaceChildren(document.createTextNode(submitLabel + ' '), icon('diagonal'));
  }
});

$$('[data-close]').forEach(button => button.addEventListener('click', () => button.closest('dialog').close()));
$$('[data-privacy]').forEach(button => button.addEventListener('click', () => {
  $('#privacy-dialog').showModal(); document.body.classList.add('dialog-open');
}));
$$('dialog').forEach(dialog => {
  dialog.addEventListener('click', event => {
    if (event.target !== dialog) return;
    const r = dialog.getBoundingClientRect();
    if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) dialog.close();
  });
  dialog.addEventListener('close', () => {
    if (!$('dialog[open]')) document.body.classList.remove('dialog-open');
  });
});
$('#menu-toggle').addEventListener('click', () => {
  const expanded = $('#menu-toggle').getAttribute('aria-expanded') === 'true';
  $('#menu-toggle').setAttribute('aria-expanded', String(!expanded));
  $('#menu-toggle').setAttribute('aria-label', expanded ? 'Открыть меню' : 'Закрыть меню');
  $('#mobile-nav').hidden = expanded;
});
$$('#mobile-nav a').forEach(link => link.addEventListener('click', closeMenu));
document.addEventListener('keydown', event => { if (event.key === 'Escape') closeMenu(); });
$('#year').textContent = new Intl.DateTimeFormat('ru', { year: 'numeric', timeZone: 'Asia/Qyzylorda' }).format(new Date());

applySettings(defaultSettings);
renderSchedule();
motion = initMotion();

async function bootstrap() {
  try {
    const response = await fetch('/site-config.json', { cache: 'no-store' });
    if (!response.ok) throw new Error('Config not found');
    const config = await response.json();
    if (!config.appsScriptUrl) return;
    if (!validEndpoint(config.appsScriptUrl)) throw new Error('Invalid endpoint');
    state.endpoint = config.appsScriptUrl;
    const data = await apiRequest(state.endpoint, null, { signal: AbortSignal.timeout(15000) });
    const schedule = normalizeSchedule(data.schedule);
    applySettings(data.settings);
    state.schedule = schedule;
    renderSchedule();
    if (booking.open && !state.busy) {
      updateFormAudience(form.elements.audience.value, form.elements.groupId.value);
      showMessage('Расписание обновилось. Проверьте выбранное время перед отправкой.');
    }
  } catch {
    $('#schedule-status').textContent = 'Не удалось обновить расписание. Перед записью уточните актуальное время у тренера.';
    $('#schedule-status').hidden = false;
  }
}

bootstrap();
