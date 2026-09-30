const DAY_MS = 24 * 60 * 60_000;

// 'YYYY-MM-DD' -> [start, end) of that UTC day.
export function utcDayBounds(date: string): { start: Date; end: Date } {
  const start = new Date(`${date}T00:00:00Z`);
  return { start, end: new Date(start.getTime() + DAY_MS) };
}

export function toUtcDate(instant: Date): string {
  return instant.toISOString().slice(0, 10);
}
