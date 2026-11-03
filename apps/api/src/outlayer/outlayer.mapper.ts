import type { PaymentStatus } from '@keiz/shared';

/** OutLayer request status -> KEIZ payment status. */
export function mapOutlayerStatus(status: string): PaymentStatus {
  switch (status) {
    case 'success':
      return 'SUCCEEDED';
    case 'failed':
    case 'rejected':
      return 'FAILED';
    case 'refunded':
      return 'REFUNDED';
    case 'needs_review':
      return 'NEEDS_REVIEW';
    case 'pending_deposit':
    case 'processing':
    case 'pending_approval':
    case 'approved':
      return 'PROCESSING';
    default:
      return 'PROCESSING';
  }
}

export function isTerminalOutlayerStatus(status: string): boolean {
  return ['success', 'failed', 'refunded', 'rejected', 'needs_review'].includes(status);
}
