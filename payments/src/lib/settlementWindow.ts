export const CAT_TIME_ZONE = 'Africa/Blantyre';

function getTimeZoneOffsetMinutes(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    timeZoneName: 'shortOffset',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date);

  const offsetLabel = parts.find((part) => part.type === 'timeZoneName')?.value ?? '';
  const match = offsetLabel.match(/GMT([+-])(\d{1,2})(?::?(\d{2}))?/i);

  if (!match) return 0;

  const sign = match[1] === '-' ? -1 : 1;
  const hours = Number(match[2] ?? 0);
  const minutes = Number(match[3] ?? 0);
  return sign * (hours * 60 + minutes);
}

function getCatLocalDateParts(referenceDate: Date) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: CAT_TIME_ZONE,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  }).formatToParts(referenceDate);

  const year = Number(parts.find((part) => part.type === 'year')?.value);
  const month = Number(parts.find((part) => part.type === 'month')?.value);
  const day = Number(parts.find((part) => part.type === 'day')?.value);

  return {
    year,
    month,
    day,
  };
}

export function getNextCatMidnightMs(referenceAt: string | number | Date = Date.now()): number {
  const referenceDate = new Date(referenceAt);
  if (Number.isNaN(referenceDate.getTime())) return Date.now();

  const { year, month, day } = getCatLocalDateParts(referenceDate);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    return Date.now();
  }

  const targetUtcGuess = Date.UTC(year, month - 1, day + 1, 0, 0, 0, 0);
  const targetOffsetMinutes = getTimeZoneOffsetMinutes(new Date(targetUtcGuess), CAT_TIME_ZONE);
  const corrected = targetUtcGuess - targetOffsetMinutes * 60_000;

  // Re-check once so the result settles on the actual CAT midnight instant.
  const correctedOffsetMinutes = getTimeZoneOffsetMinutes(new Date(corrected), CAT_TIME_ZONE);
  if (correctedOffsetMinutes !== targetOffsetMinutes) {
    return targetUtcGuess - correctedOffsetMinutes * 60_000;
  }

  return corrected;
}

export function getCountdownParts(targetMs: number, nowMs: number = Date.now()) {
  const diffMs = Math.max(0, targetMs - nowMs);
  const totalSeconds = Math.floor(diffMs / 1000);

  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;

  return { diffMs, days, hours, minutes, seconds };
}

export function canReleaseEscrow(referenceAt: string | number | Date = Date.now()): boolean {
  return Date.now() >= getNextCatMidnightMs(referenceAt);
}