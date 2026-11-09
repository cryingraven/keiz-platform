'use client';

import { ReportPeriod, ReportPeriodMode, reportPeriodLabel, reportPeriodRange } from '@/lib/period';
import { Input, Select } from './ui';

const MODES: Array<{ value: ReportPeriodMode; label: string }> = [
  { value: 'month', label: 'Monthly' },
  { value: 'quarter', label: 'Quarterly' },
  { value: 'year', label: 'Annual' },
  { value: 'custom', label: 'Custom' },
];

const CURRENT_YEAR = new Date().getUTCFullYear();
const YEARS = Array.from({ length: 8 }, (_, index) => CURRENT_YEAR - 4 + index);

export function ReportPeriodFilter({
  value,
  onChange,
}: {
  value: ReportPeriod;
  onChange: (value: ReportPeriod) => void;
}) {
  function chooseMode(mode: ReportPeriodMode) {
    if (mode === 'custom') {
      const range = reportPeriodRange(value);
      onChange({ ...value, mode, from: value.from || range.from, to: value.to || range.to });
      return;
    }
    onChange({ ...value, mode });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="inline-flex rounded-full border border-line bg-surface p-0.5">
        {MODES.map((mode) => (
          <button
            key={mode.value}
            type="button"
            onClick={() => chooseMode(mode.value)}
            className={`rounded-full px-3 py-1.5 text-[11px] font-medium transition ${
              value.mode === mode.value
                ? 'bg-ink text-white'
                : 'text-muted hover:text-ink'
            }`}
          >
            {mode.label}
          </button>
        ))}
      </div>

      {value.mode === 'month' ? (
        <Input
          type="month"
          aria-label="Report month"
          value={value.month}
          onChange={(event) => onChange({ ...value, month: event.target.value })}
          className="w-auto"
        />
      ) : null}

      {value.mode === 'quarter' ? (
        <>
          <Select
            aria-label="Report quarter"
            value={value.quarter}
            onChange={(event) =>
              onChange({ ...value, quarter: event.target.value as ReportPeriod['quarter'] })
            }
            className="w-auto"
          >
            {['1', '2', '3', '4'].map((quarter) => (
              <option key={quarter} value={quarter}>
                Q{quarter}
              </option>
            ))}
          </Select>
          <Select
            aria-label="Report year"
            value={value.year}
            onChange={(event) => onChange({ ...value, year: Number(event.target.value) })}
            className="w-auto"
          >
            {YEARS.map((year) => (
              <option key={year} value={year}>
                {year}
              </option>
            ))}
          </Select>
        </>
      ) : null}

      {value.mode === 'year' ? (
        <Select
          aria-label="Report year"
          value={value.year}
          onChange={(event) => onChange({ ...value, year: Number(event.target.value) })}
          className="w-auto"
        >
          {YEARS.map((year) => (
            <option key={year} value={year}>
              {year}
            </option>
          ))}
        </Select>
      ) : null}

      {value.mode === 'custom' ? (
        <>
          <Input
            type="date"
            aria-label="Report from date"
            value={value.from}
            onChange={(event) => onChange({ ...value, from: event.target.value })}
            className="w-auto"
          />
          <span className="text-[11px] text-muted">to</span>
          <Input
            type="date"
            aria-label="Report to date"
            value={value.to}
            onChange={(event) => onChange({ ...value, to: event.target.value })}
            className="w-auto"
          />
        </>
      ) : null}

      <span className="text-[11px] text-muted">{reportPeriodLabel(value)}</span>
    </div>
  );
}
