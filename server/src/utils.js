export const WIB_TIME_ZONE = 'Asia/Jakarta';
export const DEFAULT_DAILY_FINE_RATE = 2500;

export function formatWibDate(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: WIB_TIME_ZONE,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  }).formatToParts(date);

  const value = (type) => parts.find((part) => part.type === type)?.value;
  return `${value('day')}-${value('month')}-${value('year')}`;
}

export function addDaysWib(days, fromDate = new Date()) {
  const copy = new Date(fromDate);
  copy.setUTCDate(copy.getUTCDate() + days);
  return formatWibDate(copy);
}

export function parseDdMmYyyy(value) {
  const [day, month, year] = value.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

export function overdueDays(dueDate, now = new Date()) {
  const due = parseDdMmYyyy(dueDate);
  const todayText = formatWibDate(now);
  const today = parseDdMmYyyy(todayText);
  const diff = Math.floor((today - due) / 86400000);
  return Math.max(0, diff);
}

export function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}
