import { leonidasCup as event, distanceGroups, ageGroups, ageOnDate, ageGroupFor, distanceLabel, registrationOpen } from './events-data.js';
import { apiRequest, validEndpoint } from './api.js';

const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const form = $('#event-form');
const submit = $('#event-submit');
const submitLabel = 'Отправить заявку';
const state = { endpoint: '', ready: false, busy: false, requestId: '', fingerprint: '' };

function make(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}

function icon(id) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.classList.add('icon');
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', `#i-${id}`);
  svg.append(use);
  return svg;
}

function whatsappUrl(text) {
  const url = new URL(`https://wa.me/${event.whatsapp}`);
  if (text) url.searchParams.set('text', text);
  return url.href;
}

function renderProgram() {
  const grid = $('#distance-grid');
  const picker = $('#distance-picker');
  for (const group of distanceGroups) {
    const card = make('article', 'distance-card');
    card.append(make('h3', '', group.title));
    const list = make('ul');
    group.items.forEach(item => list.append(make('li', '', item.label)));
    card.append(list);
    grid.append(card);

    const box = make('div', 'distance-group');
    box.append(make('p', 'distance-group-title', group.title));
    const options = make('div', 'distance-options');
    for (const item of group.items) {
      const label = make('label', 'distance-option');
      const input = make('input');
      input.type = 'checkbox';
      input.name = 'distances';
      input.value = item.id;
      label.append(input, make('span', '', item.label));
      options.append(label);
    }
    box.append(options);
    picker.append(box);
  }
  const ages = $('#age-list');
  ageGroups.forEach(group => ages.append(make('li', '', group.label)));
}

function showMessage(text) {
  const el = $('#event-message');
  el.textContent = text;
  el.hidden = !text;
}

function updateAgeHint() {
  const hint = $('#age-hint');
  const value = form.elements.birthDate.value;
  const age = ageOnDate(value, event.date);
  const group = age === '' ? null : ageGroupFor(age);
  hint.classList.toggle('is-error', age !== '' && !group);
  if (!value || age === '') hint.textContent = 'Укажите дату рождения — определим возрастную группу.';
  else if (!group) hint.textContent = `На день старта — ${age} лет. Турнир проводится для участников 20 лет и старше.`;
  else hint.textContent = `На день старта — ${age} лет · возрастная группа ${group.label}`;
  form.elements.birthDate.setCustomValidity(value && !group ? 'Турнир проводится для участников 20 лет и старше.' : '');
}

function collect() {
  const data = new FormData(form);
  return {
    action: 'event_register', eventId: event.id,
    name: String(data.get('name') || '').trim().replace(/\s+/g, ' '),
    gender: String(data.get('gender') || ''),
    birthDate: String(data.get('birthDate') || ''),
    phone: String(data.get('phone') || '').trim(),
    club: String(data.get('club') || '').trim(),
    distances: data.getAll('distances').map(String),
    consent: data.get('consent') === 'on',
    website: String(data.get('website') || ''),
  };
}

function validate(payload) {
  if (payload.name.length < 5 || payload.name.split(' ').length < 2) return ['name', 'Укажите фамилию и имя участника.'];
  if (!payload.gender) return ['gender', 'Выберите зачёт: мужчины или женщины.'];
  const age = ageOnDate(payload.birthDate, event.date);
  if (age === '') return ['birthDate', 'Укажите дату рождения.'];
  if (!ageGroupFor(age)) return ['birthDate', 'Турнир проводится для участников 20 лет и старше на день старта.'];
  const digits = payload.phone.replace(/\D/g, '');
  if (!/^[+\d\s()\-]+$/.test(payload.phone) || digits.length < 10 || digits.length > 15) return ['phone', 'Проверьте номер телефона: от 10 до 15 цифр, например +7 707 000 0000.'];
  if (!payload.distances.length) return ['distances', 'Отметьте хотя бы одну дистанцию.'];
  if (!payload.consent) return ['consent', 'Нужно согласие на обработку данных заявки.'];
  return null;
}

function whatsappMessage(payload) {
  const age = ageOnDate(payload.birthDate, event.date);
  return [
    `Здравствуйте! Хочу зарегистрироваться на ${event.title}.`,
    `Участник: ${payload.name}`,
    `Зачёт: ${payload.gender === 'male' ? 'мужчины' : 'женщины'}, ${ageGroupFor(age)?.label || ''} (${payload.birthDate})`,
    `Телефон: ${payload.phone}`,
    ...(payload.club ? [`Клуб: ${payload.club}`] : []),
    `Дистанции: ${payload.distances.map(distanceLabel).join('; ')}`,
  ].join('\n');
}

function offerWhatsapp(payload, text) {
  showMessage(text);
  const link = make('a', 'button button-gold form-whatsapp');
  link.href = whatsappUrl(whatsappMessage(payload));
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.append(icon('chat'), document.createTextNode(' Отправить заявку в WhatsApp'));
  $('#event-message').append(document.createElement('br'), link);
}

form.addEventListener('submit', async e => {
  e.preventDefault();
  if (state.busy || !state.ready) return;
  const payload = collect();
  const problem = validate(payload);
  if (problem) {
    showMessage(problem[1]);
    const target = problem[0] === 'distances' ? form.querySelector('[name="distances"]') : form.elements[problem[0]];
    (target instanceof RadioNodeList ? target[0] : target)?.focus();
    return;
  }
  if (!state.endpoint) {
    offerWhatsapp(payload, 'Онлайн-регистрация временно недоступна. Отправьте заявку организаторам в WhatsApp.');
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
  submit.textContent = 'Отправляем заявку…';
  form.setAttribute('aria-busy', 'true');
  const fields = [...form.elements].filter(el => el !== submit);
  fields.forEach(el => { el.disabled = true; });
  showMessage('');
  try {
    await apiRequest(state.endpoint, payload, { method: 'POST', signal: AbortSignal.timeout(35000) });
    const group = ageGroupFor(ageOnDate(payload.birthDate, event.date));
    $('#event-success-text').textContent = `${payload.name}, заявка сохранена: ${payload.gender === 'male' ? 'мужчины' : 'женщины'}, ${group.label}, дистанций — ${payload.distances.length}. Оргкомитет свяжется с вами для подтверждения. В день старта возьмите удостоверение личности.`;
    form.hidden = true;
    $('#event-success').hidden = false;
    $('#event-success').focus();
  } catch (error) {
    const text = error.name === 'TimeoutError' || error.name === 'AbortError'
      ? 'Ответ задерживается. Попробуйте ещё раз: повторная отправка не создаст дубликат.'
      : error instanceof TypeError ? 'Не удалось связаться с сервисом. Проверьте интернет и повторите отправку.' : error.message;
    offerWhatsapp(payload, text);
  } finally {
    state.busy = false;
    fields.forEach(el => { el.disabled = false; });
    form.removeAttribute('aria-busy');
    submit.disabled = false;
    submit.replaceChildren(document.createTextNode(`${submitLabel} `), icon('diagonal'));
  }
});

form.addEventListener('input', () => { if (!state.busy) showMessage(''); });
form.elements.birthDate.addEventListener('input', updateAgeHint);
form.elements.birthDate.addEventListener('change', updateAgeHint);

$('#event-again').addEventListener('click', () => {
  form.reset();
  state.requestId = '';
  state.fingerprint = '';
  updateAgeHint();
  $('#event-success').hidden = true;
  form.hidden = false;
  form.elements.name.focus();
});

$$('[data-privacy]').forEach(button => button.addEventListener('click', () => {
  $('#privacy-dialog').showModal(); document.body.classList.add('dialog-open');
}));
$$('[data-close]').forEach(button => button.addEventListener('click', () => button.closest('dialog').close()));
$$('dialog').forEach(dialog => {
  dialog.addEventListener('click', e => { if (e.target === dialog) dialog.close(); });
  dialog.addEventListener('close', () => document.body.classList.remove('dialog-open'));
});

function closeMenu() {
  $('#mobile-nav').hidden = true;
  $('#menu-toggle').setAttribute('aria-expanded', 'false');
  $('#menu-toggle').setAttribute('aria-label', 'Открыть меню');
}
$('#menu-toggle').addEventListener('click', () => {
  const expanded = $('#menu-toggle').getAttribute('aria-expanded') === 'true';
  $('#menu-toggle').setAttribute('aria-expanded', String(!expanded));
  $('#menu-toggle').setAttribute('aria-label', expanded ? 'Открыть меню' : 'Закрыть меню');
  $('#mobile-nav').hidden = expanded;
});
$$('#mobile-nav a').forEach(link => link.addEventListener('click', closeMenu));
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeMenu(); });
$('#year').textContent = new Intl.DateTimeFormat('ru', { year: 'numeric', timeZone: 'Asia/Almaty' }).format(new Date());

renderProgram();
updateAgeHint();
// Программа рисуется скриптом и сдвигает якоря: повторяем переход по ссылке вида /events.html#register.
if (location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView();

if (!registrationOpen(event)) {
  form.hidden = true;
  $('#register-closed').hidden = false;
  $('#event-deadline').lastChild.textContent = `Онлайн-регистрация завершена ${event.registrationClosesLabel}`;
  $$('a[href="#register"]').forEach(link => { link.firstChild.textContent = 'Регистрация закрыта '; });
}

(async () => {
  try {
    const response = await fetch('/site-config.json', { cache: 'no-store' });
    if (response.ok) {
      const config = await response.json();
      if (validEndpoint(config.appsScriptUrl)) state.endpoint = config.appsScriptUrl;
    }
  } catch { /* Без конфигурации заявку можно отправить в WhatsApp. */ }
  state.ready = true;
})();
