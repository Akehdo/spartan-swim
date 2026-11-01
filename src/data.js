export const defaultSettings = {
  brandName: 'В потоке',
  coachName: 'Медхат Даиров',
  heroTitle: 'Плавать легче, чем кажется.',
  heroDescription: 'Для детей и взрослых в Астане. С нуля — до уверенной техники.',
  location: 'Астана',
  phone: '+7 707 620 4904',
  whatsapp: '77076204904',
  instagram: 'https://www.instagram.com/p/DPTBBraiJYW/',
  childrenPrice: '',
  adultsPrice: '',
  contactNote: '',
  childrenTitle: 'Уверенность в воде.',
  childrenDescription: 'Знакомимся с водой, учимся дышать и осваиваем технику.',
  adultsTitle: 'Свобода движения.',
  adultsDescription: 'Учимся плавать с нуля или совершенствуем технику.',
  coachIntro: 'Привет, я Медхат. Помогу плавать увереннее.',
};

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
