'use client';

import { Badge } from '@/components/ui/badge';
import { useTranslation } from '@/lib/i18n/context';

interface StatusBadgeProps {
  status: string;
  type?: 'processing' | 'review';
}

export function StatusBadge({ status, type = 'processing' }: StatusBadgeProps) {
  const { t } = useTranslation();

  if (type === 'processing') {
    const variants: Record<string, { variant: any; label: string }> = {
      processing: { variant: 'info', label: t.statusBadges.processing },
      completed: { variant: 'success', label: t.statusBadges.completed },
      needs_review: { variant: 'warning', label: t.statusBadges.needsReview },
      failed: { variant: 'destructive', label: t.statusBadges.failed },
    };

    const config = variants[status] || { variant: 'outline', label: status };
    return <Badge variant={config.variant}>{config.label}</Badge>;
  }

  // review status
  const variants: Record<string, { variant: any; label: string }> = {
    pending: { variant: 'warning', label: t.statusBadges.pending },
    approved: { variant: 'success', label: t.statusBadges.approved },
    rejected: { variant: 'destructive', label: t.statusBadges.rejected },
  };

  const config = variants[status] || { variant: 'outline', label: status };
  return <Badge variant={config.variant}>{config.label}</Badge>;
}
