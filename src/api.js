export function validEndpoint(value) {
  if (typeof value !== 'string' || !value) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'script.google.com' &&
      /^\/macros\/s\/[\w-]+\/exec$/.test(url.pathname) && !url.search && !url.hash;
  } catch { return false; }
}

export async function apiRequest(endpoint, payload, { method = 'GET', signal } = {}) {
  if (!validEndpoint(endpoint)) throw new Error('Онлайн-запись пока не подключена. Напишите тренеру в WhatsApp.');
  const url = new URL(endpoint);
  if (method === 'GET') url.searchParams.set('action', 'bootstrap');
  const response = await fetch(url, {
    method, signal,
    redirect: 'follow',
    ...(method === 'POST' ? { headers: { 'Content-Type': 'text/plain;charset=UTF-8' }, body: JSON.stringify(payload) } : {}),
  });
  if (!response.ok) throw new Error('Сервис записи временно недоступен. Попробуйте ещё раз или напишите тренеру.');
  let result;
  try { result = await response.json(); }
  catch { throw new Error('Сервис записи не ответил. Попробуйте ещё раз или напишите тренеру.'); }
  if (result?.ok !== true) throw new Error(result?.error?.message || 'Не удалось отправить заявку. Попробуйте ещё раз.');
  return result;
}
