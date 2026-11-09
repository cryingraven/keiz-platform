export type ListDateField = 'issueDate' | 'dueDate' | 'createdAt';

export function startOfDay(value: Date | string): Date {
  const date = new Date(value);
  date.setUTCHours(0, 0, 0, 0);
  return date;
}

export function endOfDay(value: Date | string): Date {
  const date = new Date(value);
  date.setUTCHours(23, 59, 59, 999);
  return date;
}

/**
 * Build a Mongo date clause for list endpoints. The org boundary is applied by
 * the caller; this only shapes from/to into an inclusive UTC day range.
 */
export function dateRange(
  query: { from?: string; to?: string },
  field: string,
): Record<string, unknown> | null {
  if (!query.from && !query.to) return null;
  const range: Record<string, Date> = {};
  if (query.from) range.$gte = startOfDay(query.from);
  if (query.to) range.$lte = endOfDay(query.to);
  return { [field]: range };
}
