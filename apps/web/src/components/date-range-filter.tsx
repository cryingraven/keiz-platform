'use client';

import { DateFilterValue, DatePreset, ListDateField, presetRange, today } from '@/lib/period';
import { Input, Select } from './ui';

const PRESETS: Array<{ value: DatePreset; label: string }> = [
  { value: 'all', label: 'All time' },
  { value: 'this-month', label: 'This month' },
  { value: 'last-month', label: 'Last month' },
  { value: 'this-quarter', label: 'This quarter' },
  { value: 'last-quarter', label: 'Last quarter' },
  { value: 'this-year', label: 'This year' },
  { value: 'custom', label: 'Custom range' },
];

export function DateRangeFilter({
  value,
  onChange,
  showDateField = true,
  issueLabel = 'Issue date',
  includeCreatedAt = false,
}: {
  value: DateFilterValue;
  onChange: (value: DateFilterValue) => void;
  showDateField?: boolean;
  issueLabel?: string;
  includeCreatedAt?: boolean;
}) {
  const fields: Array<{ value: ListDateField; label: string }> = [
    { value: 'issueDate', label: issueLabel },
    { value: 'dueDate', label: 'Due date' },
    ...(includeCreatedAt ? [{ value: 'createdAt' as const, label: 'Created date' }] : []),
  ];

  function choosePreset(preset: DatePreset) {
    if (preset === 'custom') {
      onChange({
        ...value,
        preset,
        from: value.from || today(),
        to: value.to || today(),
      });
      return;
    }
    if (preset === 'all') {
      onChange({ ...value, preset, from: '', to: '' });
      return;
    }
    onChange({ ...value, preset, ...presetRange(preset) });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select
        aria-label="Date range"
        value={value.preset}
        onChange={(event) => choosePreset(event.target.value as DatePreset)}
        className="w-auto min-w-[132px]"
      >
        {PRESETS.map((preset) => (
          <option key={preset.value} value={preset.value}>
            {preset.label}
          </option>
        ))}
      </Select>

      {value.preset === 'custom' ? (
        <>
          <Input
            type="date"
            aria-label="From date"
            value={value.from}
            onChange={(event) => onChange({ ...value, preset: 'custom', from: event.target.value })}
            className="w-auto"
          />
          <span className="text-[12px] text-muted">to</span>
          <Input
            type="date"
            aria-label="To date"
            value={value.to}
            onChange={(event) => onChange({ ...value, preset: 'custom', to: event.target.value })}
            className="w-auto"
          />
        </>
      ) : null}

      {showDateField ? (
        <Select
          aria-label="Date field"
          value={value.dateField}
          onChange={(event) =>
            onChange({ ...value, dateField: event.target.value as ListDateField })
          }
          className="w-auto min-w-[124px]"
        >
          {fields.map((field) => (
            <option key={field.value} value={field.value}>
              {field.label}
            </option>
          ))}
        </Select>
      ) : null}
    </div>
  );
}
