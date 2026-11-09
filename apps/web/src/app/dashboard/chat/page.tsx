'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAssistant } from '@/components/assistant';
import { Card, Spinner } from '@/components/ui';

export default function ChatPage() {
  const router = useRouter();
  const { openAssistant } = useAssistant();

  useEffect(() => {
    openAssistant();
    router.replace('/dashboard');
  }, [openAssistant, router]);

  return (
    <Card className="grid min-h-[240px] place-items-center">
      <div className="flex items-center gap-2 text-sm text-muted">
        <Spinner /> Opening assistant…
      </div>
    </Card>
  );
}
