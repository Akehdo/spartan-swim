export const defaultSettings = {
  brandName: 'SPARTAN SWIM',
  coachName: 'Медхат Даиров',
  heroTitle: 'Характер рождается в воде.',
  heroDescription: 'Школа плавания для детей и взрослых в Астане. От первого вдоха до уверенной техники.',
  location: 'Астана',
  phone: '+7 707 620 4904',
  whatsapp: '77076204904',
  instagram: 'https://www.instagram.com/p/DPTBBraiJYW/',
  contactNote: '',
  coachIntro: 'Старший тренер Spartan Swim. Поможет подобрать тренера и группу по вашему уровню.',
};

export const defaultCoaches = [
  { id: 'medhat', name: 'Медхат Даиров', role: 'Старший тренер', image: '/images/medhat-coach.jpg', senior: true, active: true },
  { id: 'erik', name: 'Рускулов Эрик Рустамович', role: 'Тренер по плаванию', image: '/images/coach-erik.png', senior: false, active: true },
  { id: 'konstantin', name: 'Романенко Константин Максимович', role: 'Тренер по плаванию', image: '/images/coach-konstantin.png', senior: false, active: true },
  { id: 'andrey', name: 'Беляков Андрей Андреевич', role: 'Тренер по плаванию', image: '/images/coach-andrey.png', senior: false, active: true },
];

export function normalizeCoaches(input) {
  if (!Array.isArray(input)) throw new Error('Некорректный список тренеров');
  const ids = new Set();
  return input.map(coach => {
    if (!coach || typeof coach.id !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(coach.id) || ids.has(coach.id) ||
      typeof coach.name !== 'string' || coach.name.trim().length < 2 || coach.name.length > 150 ||
      typeof coach.role !== 'string' || !coach.role.trim() || coach.role.length > 150 ||
      typeof coach.senior !== 'boolean' || typeof coach.active !== 'boolean' || !validCoachImage(coach.image)) {
      throw new Error('Некорректный список тренеров');
    }
    ids.add(coach.id);
    return { ...coach, name: coach.name.trim(), role: coach.role.trim() };
  });
}

function validCoachImage(value) {
  if (typeof value !== 'string' || value.length > 2000) return false;
  if (/^\/images\/[a-zA-Z0-9_-]+\.(?:png|jpe?g|webp|avif)$/i.test(value)) return true;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password;
  } catch { return false; }
}

function groups(audience, key, days, times) {
  return times.map(([start, level = 'all']) => ({
    id: `${audience}-${key}-${start.replace(':', '')}`,
    audience, days, start,
    end: `${String(Number(start.slice(0, 2)) + 1).padStart(2, '0')}:00`,
    level, active: true,
  }));
}

export const defaultSchedule = [
  ...groups('children', 'mwf', ['mon', 'wed', 'fri'], [['08:00'], ['15:00'], ['19:00'], ['20:00']]),
  ...groups('children', 'tts', ['tue', 'thu', 'sat'], [['08:00'], ['16:00'], ['19:00'], ['20:00']]),
  ...groups('adults', 'mwf', ['mon', 'wed', 'fri'], [['08:00'], ['12:00'], ['13:00', 'master'], ['19:00', 'master'], ['21:00']]),
  ...groups('adults', 'tt', ['tue', 'thu'], [['08:00'], ['12:00']]),
];

export const dayLabels = { mon: 'Пн', tue: 'Вт', wed: 'Ср', thu: 'Чт', fri: 'Пт', sat: 'Сб', sun: 'Вс' };
export const dayNames = { mon: 'Понедельник', tue: 'Вторник', wed: 'Среда', thu: 'Четверг', fri: 'Пятница', sat: 'Суббота', sun: 'Воскресенье' };

export function groupLabel(group) {
  return `${group.days.map(day => dayLabels[day]).join(' / ')} · ${group.start}–${group.end}`;
}

export function availableGroups(schedule, audience) {
  return schedule.filter(group => group.audience === audience && group.active && group.level !== 'master');
}

export function normalizeSchedule(input) {
  if (!Array.isArray(input)) throw new Error('Некорректное расписание');
  const ids = new Set();
  return input.map(group => {
    if (!group || typeof group.id !== 'string' || !group.id.trim() || ids.has(group.id) ||
      !['children', 'adults'].includes(group.audience) || !Array.isArray(group.days) ||
      !group.days.length || group.days.some(day => !Object.hasOwn(dayLabels, day)) ||
      !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(group.start) ||
      !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(group.end) ||
      group.end <= group.start || !['all', 'master'].includes(group.level) ||
      typeof group.active !== 'boolean') throw new Error('Некорректное расписание');
    ids.add(group.id);
    return { ...group, days: [...new Set(group.days)] };
  });
}
