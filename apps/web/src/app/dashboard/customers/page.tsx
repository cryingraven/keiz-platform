'use client';

import { useMemo, useState } from 'react';
import { Archive, ArchiveRestore, Contact, Mail, Pencil, Plus, Search } from 'lucide-react';
import { useApi } from '@/lib/hooks';
import { useAuth } from '@/lib/auth';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/shell';
import { CustomerForm, type CustomerRecord } from '@/components/receivable-form';
import { Badge, Button, Card, EmptyState, ErrorState, Input, Spinner } from '@/components/ui';

interface CustomerRow extends CustomerRecord {
  status?: string;
}

interface ReceivableRow {
  customerId: string;
}

export default function CustomersPage() {
  const [showArchived, setShowArchived] = useState(false);
  const customers = useApi<CustomerRow[]>(
    showArchived ? '/customers?includeArchived=true' : '/customers',
  );
  const receivables = useApi<ReceivableRow[]>('/receivables');
  const { session } = useAuth();
  const canAdmin = ['ADMIN', 'OWNER'].includes(session?.role ?? '');
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<CustomerRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  const counts = useMemo(() => {
    const map = new Map<string, number>();
    (receivables.data ?? []).forEach((row) =>
      map.set(row.customerId, (map.get(row.customerId) ?? 0) + 1),
    );
    return map;
  }, [receivables.data]);

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return customers.data ?? [];
    return (customers.data ?? []).filter(
      (customer) =>
        customer.name.toLowerCase().includes(needle) ||
        customer.email.toLowerCase().includes(needle),
    );
  }, [customers.data, query]);

  function openCreate() {
    setEditing(null);
    setOpen(true);
  }

  function openEdit(customer: CustomerRecord) {
    setEditing(customer);
    setOpen(true);
  }

  async function archive(customer: CustomerRow) {
    if (!window.confirm(`Archive ${customer.name}? Existing invoices keep their history.`)) return;
    setError(null);
    try {
      await api(`/customers/${customer._id}`, { method: 'DELETE' });
      await customers.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not archive the customer');
    }
  }

  async function restore(customer: CustomerRow) {
    setError(null);
    try {
      await api(`/customers/${customer._id}/restore`, { method: 'POST' });
      await customers.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not restore the customer');
    }
  }

  return (
    <div>
      <PageHeader
        title="Customers"
        description="Who you invoice, and where their receipts land."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative w-full sm:w-56">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" />
              <Input
                placeholder="Search name or email"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                className="pl-9"
              />
            </div>
            <Button
              variant="secondary"
              onClick={() => setShowArchived((value) => !value)}
            >
              {showArchived ? 'Hide archived' : 'Show archived'}
            </Button>
            <Button onClick={openCreate}>
              <Plus className="h-3.5 w-3.5" /> Add customer
            </Button>
          </div>
        }
      />

      {error ? (
        <p className="mb-4 rounded-xl border border-rose/20 bg-rose-soft px-3 py-2 text-xs text-rose">
          {error}
        </p>
      ) : null}

      {customers.loading ? (
        <div className="flex items-center gap-2 text-sm text-muted">
          <Spinner /> Loading customers
        </div>
      ) : customers.error ? (
        <Card>
          <ErrorState message={customers.error} onRetry={() => void customers.reload()} />
        </Card>
      ) : rows.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Contact className="h-5 w-5" />}
            title={query ? 'No matches' : 'No customers yet'}
            body={
              query
                ? 'Try a different name or email.'
                : 'Add a customer before issuing a receivable. They receive the invoices you issue and their receipts roll up here.'
            }
            action={
              query ? (
                <Button variant="secondary" onClick={() => setQuery('')}>
                  Clear search
                </Button>
              ) : (
                <Button onClick={openCreate}>Add customer</Button>
              )
            }
          />
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {rows.map((customer) => (
            <Card key={customer._id} className="p-5 transition hover:border-line-strong">
              <div className="flex items-start justify-between gap-3">
                <div className="grid h-9 w-9 place-items-center rounded-xl bg-paper">
                  <Contact className="h-4 w-4" />
                </div>
                <div className="flex items-center gap-1">
                  {customer.status === 'ARCHIVED' ? (
                    <Badge className="border-line bg-paper text-muted">Archived</Badge>
                  ) : null}
                  {canAdmin ? (
                    <>
                      {customer.status === 'ARCHIVED' ? (
                        <button
                          type="button"
                          onClick={() => void restore(customer)}
                          className="rounded-lg p-1.5 text-muted transition hover:bg-paper hover:text-ink"
                          aria-label={`Restore ${customer.name}`}
                        >
                          <ArchiveRestore className="h-3.5 w-3.5" />
                        </button>
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={() => openEdit(customer)}
                            className="rounded-lg p-1.5 text-muted transition hover:bg-paper hover:text-ink"
                            aria-label={`Edit ${customer.name}`}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => void archive(customer)}
                            className="rounded-lg p-1.5 text-muted transition hover:bg-rose-soft hover:text-rose"
                            aria-label={`Archive ${customer.name}`}
                          >
                            <Archive className="h-3.5 w-3.5" />
                          </button>
                        </>
                      )}
                    </>
                  ) : null}
                </div>
              </div>
              <h3 className="mt-3 text-[15px] font-semibold tracking-tight">{customer.name}</h3>
              <p className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted">
                <Mail className="h-3 w-3" /> {customer.email}
              </p>
              <p className="mt-2 text-[11px] text-muted">
                {counts.get(customer._id) ?? 0} receivable
                {(counts.get(customer._id) ?? 0) === 1 ? '' : 's'}
              </p>
              {customer.taxId || customer.billingAddress ? (
                <div className="mt-4 space-y-1 rounded-xl bg-paper px-3 py-2.5">
                  {customer.taxId ? (
                    <p className="text-[10px] uppercase tracking-wider text-muted">
                      Tax ID ·{' '}
                      <span className="font-num normal-case tracking-normal text-ink">
                        {customer.taxId}
                      </span>
                    </p>
                  ) : null}
                  {customer.billingAddress ? (
                    <p className="text-[10px] uppercase tracking-wider text-muted">
                      Billing address ·{' '}
                      <span className="normal-case tracking-normal text-ink">
                        {customer.billingAddress}
                      </span>
                    </p>
                  ) : null}
                </div>
              ) : null}
            </Card>
          ))}
        </div>
      )}

      <CustomerForm
        key={editing?._id ?? 'new'}
        open={open}
        customer={editing}
        onClose={() => {
          setOpen(false);
          setEditing(null);
        }}
        onCreated={() => void customers.reload()}
      />
    </div>
  );
}
