/** Турниры Spartan Swim. Дистанции и сроки совпадают с google-apps-script/Code.gs (EVENTS). */
export const distanceGroups = [
  { title: '50 м · без ласт', items: [
    ['free50', 'Вольный стиль'], ['back50', 'На спине'], ['breast50', 'Брасс'], ['fly50', 'Баттерфляй'],
  ] },
  { title: '50 м · в ластах', items: [
    ['free50f', 'Вольный стиль'], ['back50f', 'На спине'], ['breast50f', 'Брасс'], ['fly50f', 'Баттерфляй'],
  ] },
  { title: '200 м', items: [
    ['free200', 'Вольный стиль · без ласт'], ['free200f', 'Вольный стиль · в ластах'],
  ] },
  { title: '400 м', items: [
    ['free400', 'Вольный стиль · без ласт'], ['free400f', 'Вольный стиль · в ластах'],
  ] },
  { title: 'Эстафеты 4 × 50 м', items: [
    ['relayFree', 'Вольный стиль, 200 м'], ['relayIm', 'Комплексное плавание, 200 м'],
  ] },
].map(group => ({ ...group, items: group.items.map(([id, label]) => ({ id, label })) }));

const distanceTitles = Object.fromEntries(distanceGroups.flatMap(group => group.items.map(item => [item.id, `${group.title.replace(' · ', ', ')}: ${item.label}`])));

export const ageGroups = [
  { id: '20-29', label: '20–29 лет', min: 20, max: 29 },
  { id: '30-39', label: '30–39 лет', min: 30, max: 39 },
  { id: '40-49', label: '40–49 лет', min: 40, max: 49 },
  { id: '50+', label: '50+', min: 50, max: 200 },
];

export const leonidasCup = {
  id: 'leonidas-2027',
  title: 'LEONIDAS SWIM CUP 2027',
  date: '2027-01-03',
  dateLabel: '3 января 2027',
  weekday: 'воскресенье',
  start: '08:00',
  end: '16:00',
  city: 'Кокшетау',
  venue: 'КГУ СДЮСШ «Бурабай»',
  address: 'ул. Т. Бегельдинова, 83',
  // Положение: заявки не позднее чем за 7 дней до старта. Время Кокшетау — UTC+5.
  registrationCloses: '2026-12-27T23:59:59+05:00',
  registrationClosesLabel: '27 декабря 2026',
  whatsapp: '77088081378',
  whatsappLabel: '+7 708 808 1378',
};

export function distanceLabel(id) {
  return distanceTitles[id] || '';
}

/** Полных лет на дату старта; '' если дата рождения некорректна. */
export function ageOnDate(birthDate, eventDate) {
  const birth = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(birthDate));
  const event = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(eventDate));
  if (!birth || !event) return '';
  const [y, m, d] = birth.slice(1).map(Number);
  const check = new Date(Date.UTC(y, m - 1, d));
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== m - 1 || check.getUTCDate() !== d) return '';
  const [ey, em, ed] = event.slice(1).map(Number);
  const age = ey - y - (em < m || (em === m && ed < d) ? 1 : 0);
  return age >= 0 ? age : '';
}

export function ageGroupFor(age) {
  return ageGroups.find(group => age >= group.min && age <= group.max) || null;
}

export function registrationOpen(event, now = new Date()) {
  return now.getTime() <= new Date(event.registrationCloses).getTime();
}
