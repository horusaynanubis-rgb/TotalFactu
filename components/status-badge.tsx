'use client';

import { Badge } from '@/components/ui/badge';
import { useTranslation } from '@/lib/i18n/context';
import type { UnifiedStatus } from '@/lib/unified-status';

interface StatusBadgeProps {
  status: string;
  type?: 'processing' | 'review' | 'unified';
}

export function StatusBadge({ status, type = 'processing' }: StatusBadgeProps) {
  const { t } = useTranslation();

  if (type === 'unified') {
    const s = status as UnifiedStatus;
    const config: Record<UnifiedStatus, { variant: any; label: string }> = {
      processing: { variant: 'info',        label: t.unifiedStatus.processing },
      error:      { variant: 'destructive', label: t.unifiedStatus.error },
      pending:    { variant: 'warning',     label: t.unifiedStatus.pending },
      reviewed:   { variant: 'success',     label: t.unifiedStatus.reviewed },
      rejected:   { variant: 'destructive', label: t.unifiedStatus.rejected },
      waiting:    { variant: 'info',        label: t.unifiedStatus.waiting },
      done:       { variant: 'success',     label: t.unifiedStatus.done },
    };
    const cfg = config[s] ?? { variant: 'outline', label: status };
    return <Badge variant={cfg.variant}>{cfg.label}</Badge>;
  }

  if (type === 'processing') {
    const variants: Record<string, { variant: any; label: string }> = {
      processing:  { variant: 'info',        label: t.unifiedStatus.processing },
      completed:   { variant: 'success',     label: t.statusBadges.completed },
      needs_review:{ variant: 'warning',     label: t.unifiedStatus.pending },
      failed:      { variant: 'destructive', label: t.unifiedStatus.error },
    };
    const config = variants[status] || { variant: 'outline', label: status };
    return <Badge variant={config.variant}>{config.label}</Badge>;
  }

  // review status → map to unified labels
  const variants: Record<string, { variant: any; label: string }> = {
    pending:  { variant: 'warning',     label: t.unifiedStatus.pending },
    approved: { variant: 'success',     label: t.unifiedStatus.reviewed },
    rejected: { variant: 'destructive', label: t.unifiedStatus.rejected },
  };
  const config = variants[status] || { variant: 'outline', label: status };
  return <Badge variant={config.variant}>{config.label}</Badge>;
}
