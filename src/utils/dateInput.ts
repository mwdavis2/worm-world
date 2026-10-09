// Dates for an <input type='date'>, whose value is 'YYYY-MM-DD' in local time
// ('' while the user is part-way through typing one).

const pad = (n: number, width = 2): string => String(n).padStart(width, '0');

/** The 'YYYY-MM-DD' text of a date, in local time. */
export const toDateInputValue = (date: Date): string =>
  `${pad(date.getFullYear(), 4)}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate()
  )}`;

/**
 * The local date of a 'YYYY-MM-DD' text, or undefined when it is empty or not a
 * real date (such as 2026-02-30).
 */
export const fromDateInputValue = (value: string): Date | undefined => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (match === null) return undefined;
  const [year, month, day] = [
    Number(match[1]),
    Number(match[2]),
    Number(match[3]),
  ];
  const date = new Date(year, month - 1, day);
  const real =
    date.getFullYear() === year &&
    date.getMonth() === month - 1 &&
    date.getDate() === day;
  return real ? date : undefined;
};
