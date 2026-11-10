'use client';

import { useState } from 'react';
import { Plus, ShieldCheck, Trash2, UserPlus, Users } from 'lucide-react';
import { useApi } from '@/lib/hooks';
import { useAuth } from '@/lib/auth';
import { api } from '@/lib/api';
import { humanize, shortAddress } from '@/lib/format';
import { PageHeader } from '@/components/shell';
import { useConfirm, useToast } from '@/components/feedback';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Input,
  Label,
  Modal,
  Select,
  Spinner,
} from '@/components/ui';

interface Member {
  userId: string;
  accountId: string;
  displayName: string | null;
  role: string;
  joinedAt: string | null;
}

const ROLES = ['OWNER', 'ADMIN', 'APPROVER', 'MEMBER'] as const;

const ROLE_HELP: Record<string, string> = {
  OWNER: 'Full control, including policy and custody handoff.',
  ADMIN: 'Can approve, pay, simulate and manage vendors.',
  APPROVER: 'Can approve bills and record receipts.',
  MEMBER: 'Can create bills and read the books.',
};

export default function TeamPage() {
  const members = useApi<Member[]>('/members');
  const { session } = useAuth();
  const canAdmin = ['OWNER', 'ADMIN'].includes(session?.role ?? '');
  const [open, setOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const confirm = useConfirm();
  const toast = useToast();

  async function changeRole(member: Member, role: string) {
    setBusyId(member.userId);
    setError(null);
    try {
      await api(`/members/${member.userId}`, {
        method: 'PATCH',
        body: JSON.stringify({ role }),
      });
      await members.reload();
      toast('Role updated');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not change the role');
    } finally {
      setBusyId(null);
    }
  }

  async function remove(member: Member) {
    const ok = await confirm({
      title: 'Remove this member?',
      body: `${member.accountId} will lose access to this workspace. Their history stays in the audit log.`,
      confirmLabel: 'Remove member',
      tone: 'danger',
    });
    if (!ok) return;
    setBusyId(member.userId);
    setError(null);
    try {
      await api(`/members/${member.userId}`, { method: 'DELETE' });
      await members.reload();
      toast('Member removed');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not remove the member');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      <PageHeader
        title="Team"
        description="Who can approve bills, change policy and read the books."
        actions={
          canAdmin ? (
            <Button onClick={() => setOpen(true)}>
              <Plus className="h-3.5 w-3.5" /> Add member
            </Button>
          ) : null
        }
      />

      {error ? (
        <p className="mb-4 rounded-xl border border-rose/20 bg-rose-soft px-3 py-2 text-xs text-rose">
          {error}
        </p>
      ) : null}

      {members.loading ? (
        <div className="flex items-center gap-2 text-sm text-muted">
          <Spinner /> Loading members
        </div>
      ) : members.error ? (
        <Card>
          <ErrorState message={members.error} onRetry={() => void members.reload()} />
        </Card>
      ) : (members.data?.length ?? 0) === 0 ? (
        <Card>
          <EmptyState
            icon={<Users className="h-5 w-5" />}
            title="No members"
            body="Add a teammate by their NEAR account id."
          />
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="border-b border-line px-5 py-4">
            <p className="text-sm font-semibold">Members</p>
            <p className="mt-0.5 text-xs text-muted">
              Roles are reloaded on every request, so a change takes effect immediately.
            </p>
          </div>
          <ul className="divide-y divide-line">
            {(members.data ?? []).map((member) => {
              const self = member.userId === session?.user?.id;
              return (
                <li key={member.userId} className="flex flex-wrap items-center gap-3 px-5 py-4">
                  <div className="grid h-9 w-9 place-items-center rounded-xl bg-paper">
                    <Users className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-2 text-[14px] font-medium">
                      <span className="font-num">{shortAddress(member.accountId, 8)}</span>
                      {self ? (
                        <Badge className="border-line bg-paper text-muted">You</Badge>
                      ) : null}
                    </p>
                    <p className="font-num truncate text-[12px] text-muted">
                      {member.accountId}
                    </p>
                  </div>
                  {canAdmin ? (
                    <Select
                      className="w-36"
                      value={member.role}
                      disabled={busyId === member.userId}
                      onChange={(event) => void changeRole(member, event.target.value)}
                    >
                      {ROLES.map((role) => (
                        <option key={role} value={role}>
                          {humanize(role)}
                        </option>
                      ))}
                    </Select>
                  ) : (
                    <Badge className="border-line bg-paper text-muted">
                      {humanize(member.role)}
                    </Badge>
                  )}
                  {canAdmin ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busyId === member.userId}
                      onClick={() => void remove(member)}
                      aria-label={`Remove ${member.accountId}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  ) : null}
                </li>
              );
            })}
          </ul>
          <div className="flex items-start gap-2 border-t border-line bg-paper/50 px-5 py-3 text-[12px] text-muted">
            <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-mint" />
            <span>
              OWNER: {ROLE_HELP.OWNER} ADMIN: {ROLE_HELP.ADMIN} APPROVER: {ROLE_HELP.APPROVER}{' '}
              MEMBER: {ROLE_HELP.MEMBER}
            </span>
          </div>
        </Card>
      )}

      <AddMemberModal
        open={open}
        onClose={() => setOpen(false)}
        onAdded={() => {
          void members.reload();
        }}
      />
    </div>
  );
}

function AddMemberModal({
  open,
  onClose,
  onAdded,
}: {
  open: boolean;
  onClose: () => void;
  onAdded: () => void;
}) {
  const [accountId, setAccountId] = useState('');
  const [role, setRole] = useState('MEMBER');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await api('/members', {
        method: 'POST',
        body: JSON.stringify({ accountId: accountId.trim(), role }),
      });
      onAdded();
      onClose();
      setAccountId('');
      setRole('MEMBER');
      toast('Member added');

    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add the member');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add a member"
      description="They must sign in once with this NEAR account to see the workspace."
    >
      <div className="space-y-3">
        <div>
          <Label htmlFor="m-account">NEAR account id</Label>
          <Input
            id="m-account"
            placeholder="alice.near"
            value={accountId}
            onChange={(event) => setAccountId(event.target.value)}
          />
        </div>
        <div>
          <Label htmlFor="m-role">Role</Label>
          <Select id="m-role" value={role} onChange={(event) => setRole(event.target.value)}>
            {ROLES.map((item) => (
              <option key={item} value={item}>
                {humanize(item)}
              </option>
            ))}
          </Select>
          <p className="mt-1.5 text-[12px] text-muted">{ROLE_HELP[role]}</p>
        </div>
        {error ? (
          <p className="rounded-xl border border-rose/20 bg-rose-soft px-3 py-2 text-xs text-rose">
            {error}
          </p>
        ) : null}
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            loading={busy}
            disabled={accountId.trim().length < 2}
            onClick={() => void submit()}
          >
            <UserPlus className="h-3.5 w-3.5" /> Add member
          </Button>
        </div>
      </div>
    </Modal>
  );
}
