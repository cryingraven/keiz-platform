import { formatMoney } from '@/lib/format';
import { Card, ErrorState, Skeleton } from '@/components/ui';
import type { Aging, DataState } from './types';

function AgingPanel({
  title,
  hint,
  report,
}: {
  title: string;
  hint: string;
  report: DataState<Aging>;
}) {
  return (
    <div className="p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-[14px] font-semibold">{title}</h3>
          <p className="mt-0.5 text-[12px] text-muted">{hint}</p>
        </div>
      </div>

      {report.loading ? (
        <div className="mt-4 space-y-2">
          {Array.from({ length: 5 }).map((_, index) => (
            <Skeleton key={index} className="h-5 w-full" />
          ))}
        </div>
      ) : report.error ? (
        <ErrorState message={report.error} onRetry={() => void report.reload()} />
      ) : !report.data ? (
        <p className="mt-4 text-[13px] text-muted">No aging data available.</p>
      ) : (
        <div className="mt-4 space-y-2">
          {report.data.buckets.map((bucket) => (
            <div
              key={bucket.key}
              className="flex items-center justify-between gap-3 text-[13px]"
            >
              <span className="text-muted">
                {bucket.label}
                <span className="ml-1 text-[11px]">({bucket.count})</span>
              </span>
              <span className="font-num shrink-0">
                {formatMoney(bucket.amount, report.data!.decimals, report.data!.currency)}
              </span>
            </div>
          ))}
          <div className="flex items-center justify-between gap-3 border-t border-line pt-2 text-[13px] font-semibold">
            <span>Total</span>
            <span className="font-num">
              {formatMoney(report.data.total, report.data.decimals, report.data.currency)}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

export function AgingTab({
  apAging,
  arAging,
}: {
  apAging: DataState<Aging>;
  arAging: DataState<Aging>;
}) {
  return (
    <Card className="overflow-hidden">
      <div className="border-b border-line px-4 py-4 sm:px-5">
        <h2 className="text-[16px] font-semibold tracking-tight">AP &amp; AR aging</h2>
        <p className="mt-0.5 text-[12px] text-muted">
          Open items grouped by how long they have been outstanding. As of today.
        </p>
      </div>
      <div className="grid divide-y divide-line lg:grid-cols-2 lg:divide-x lg:divide-y-0">
        <AgingPanel
          title="Accounts payable"
          hint="Approved bills not yet paid"
          report={apAging}
        />
        <AgingPanel
          title="Accounts receivable"
          hint="Issued invoices not yet collected"
          report={arAging}
        />
      </div>
    </Card>
  );
}
