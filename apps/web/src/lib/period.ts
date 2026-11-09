export type ListDateField = 'issueDate' | 'dueDate' | 'createdAt';

export type DatePreset =
  | 'all'
  | 'this-month'
  | 'last-month'
  | 'this-quarter'
  | 'last-quarter'
  | 'this-year'
  | 'custom';

export interface DateFilterValue {
  preset: DatePreset;
  from: string;
  to: string;
  dateField: ListDateField;
}

export const EMPTY_DATE_FILTER: DateFilterValue = {
  preset: 'all',
  from: '',
  to: '',
  dateField: 'issueDate',
};

export type ReportPeriodMode = 'month' | 'quarter' | 'year' | 'custom';

export interface ReportPeriod {
  mode: ReportPeriodMode;
  month: string;
  quarter: '1' | '2' | '3' | '4';
  year: number;
  from: string;
  to: string;
}

function day(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function utcDate(year: number, month: number, dayOfMonth: number): Date {
  return new Date(Date.UTC(year, month, dayOfMonth));
}

export function today(): string {
  return day(new Date());
}

export function defaultReportPeriod(): ReportPeriod {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth() + 1;
  return {
    mode: 'month',
    month: `${year}-${String(month).padStart(2, '0')}`,
    quarter: String(Math.floor((month - 1) / 3) + 1) as ReportPeriod['quarter'],
    year,
    from: '',
    to: '',
  };
}

export function monthRange(month: string): { from: string; to: string } {
  const [year, monthNumber] = month.split('-').map(Number);
  const safeYear = Number.isFinite(year) ? year : new Date().getUTCFullYear();
  const safeMonth = Number.isFinite(monthNumber) ? monthNumber : 1;
  return {
    from: day(utcDate(safeYear, safeMonth - 1, 1)),
    to: day(utcDate(safeYear, safeMonth, 0)),
  };
}

export function quarterRange(year: number, quarter: number): { from: string; to: string } {
  const startMonth = (quarter - 1) * 3;
  return {
    from: day(utcDate(year, startMonth, 1)),
    to: day(utcDate(year, startMonth + 3, 0)),
  };
}

export function yearRange(year: number): { from: string; to: string } {
  return { from: `${year}-01-01`, to: `${year}-12-31` };
}

export function reportPeriodRange(period: ReportPeriod): { from: string; to: string } {
  if (period.mode === 'custom') {
    return {
      from: period.from || `${period.year}-01-01`,
      to: period.to || today(),
    };
  }
  if (period.mode === 'quarter') {
    return quarterRange(period.year, Number(period.quarter));
  }
  if (period.mode === 'year') return yearRange(period.year);
  return monthRange(period.month);
}

export function presetRange(preset: DatePreset): { from: string; to: string } {
  const now = new Date();
  const year = now.getUTCFullYear();
  const monthIndex = now.getUTCMonth();
  if (preset === 'this-month') {
    return { from: day(utcDate(year, monthIndex, 1)), to: day(utcDate(year, monthIndex + 1, 0)) };
  }
  if (preset === 'last-month') {
    return { from: day(utcDate(year, monthIndex - 1, 1)), to: day(utcDate(year, monthIndex, 0)) };
  }
  if (preset === 'this-quarter') {
    return quarterRange(year, Math.floor(monthIndex / 3) + 1);
  }
  if (preset === 'last-quarter') {
    const quarter = Math.floor(monthIndex / 3) + 1;
    return quarter === 1 ? quarterRange(year - 1, 4) : quarterRange(year, quarter - 1);
  }
  if (preset === 'this-year') return yearRange(year);
  return { from: '', to: '' };
}

export function startOfDayIso(value: string): string {
  return `${value}T00:00:00.000Z`;
}

export function endOfDayIso(value: string): string {
  return `${value}T23:59:59.999Z`;
}

export function dateFilterQuery(value: DateFilterValue, includeDateField = true): string {
  const params = new URLSearchParams();
  if (value.from && value.to) {
    params.set('from', startOfDayIso(value.from));
    params.set('to', endOfDayIso(value.to));
  }
  if (includeDateField) params.set('dateField', value.dateField);
  const query = params.toString();
  return query ? `?${query}` : '';
}

const MONTH_FORMAT = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  timeZone: 'UTC',
});

export function formatRange(from: string, to: string): string {
  if (!from || !to) return 'All time';
  return `${MONTH_FORMAT.format(new Date(startOfDayIso(from)))} – ${MONTH_FORMAT.format(
    new Date(startOfDayIso(to)),
  )}`;
}

export function reportPeriodLabel(period: ReportPeriod): string {
  if (period.mode === 'month') {
    return new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
      new Date(`${period.month}-01T00:00:00.000Z`),
    );
  }
  if (period.mode === 'quarter') return `Q${period.quarter} ${period.year}`;
  if (period.mode === 'year') return String(period.year);
  const range = reportPeriodRange(period);
  return formatRange(range.from, range.to);
}
