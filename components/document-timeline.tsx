'use client';

import { CheckCircle2, Circle, AlertCircle } from 'lucide-react';
import { getUnifiedStatus, getTimelineStep, type UnifiedStatus } from '@/lib/unified-status';

interface DocumentTimelineProps {
  processingStatus: string;
  reviewStatus?: string | null;
  gestoriaStatus?: string | null;
}

interface Stage {
  key: string;
  label: string;
  step: number;
}

const STAGES: Stage[] = [
  { key: 'received',   label: 'Documento recibido',    step: 1 },
  { key: 'processing', label: 'Procesando IA',          step: 2 },
  { key: 'pending',    label: 'Pendiente de revisión',  step: 3 },
  { key: 'reviewed',   label: 'Revisada',               step: 4 },
  { key: 'waiting',    label: 'Esperando cliente',      step: 5 },
  { key: 'done',       label: 'Finalizada',             step: 6 },
];

export function DocumentTimeline({
  processingStatus,
  reviewStatus,
  gestoriaStatus,
}: DocumentTimelineProps) {
  const unified = getUnifiedStatus({ processingStatus, reviewStatus, gestoriaStatus });
  const isError = unified === 'error' || unified === 'rejected';
  const currentStep = isError ? getTimelineStep(unified) : getTimelineStep(unified);

  return (
    <ol className="relative ml-2 border-l border-gray-200 space-y-3 py-1">
      {STAGES.map((stage) => {
        const done = stage.step < currentStep;
        const active = stage.step === currentStep && !isError;
        const errorAt = isError && stage.step === currentStep;

        return (
          <li key={stage.key} className="pl-5">
            <span
              className={`absolute -left-[9px] flex items-center justify-center w-4 h-4 rounded-full ring-2 ring-white ${
                errorAt
                  ? 'bg-red-500'
                  : done
                  ? 'bg-emerald-500'
                  : active
                  ? 'bg-blue-500'
                  : 'bg-gray-200'
              }`}
            >
              {errorAt ? (
                <AlertCircle className="h-2.5 w-2.5 text-white" />
              ) : done ? (
                <CheckCircle2 className="h-2.5 w-2.5 text-white" />
              ) : (
                <Circle className={`h-2.5 w-2.5 ${active ? 'text-white' : 'text-gray-400'}`} />
              )}
            </span>
            <p
              className={`text-xs leading-tight ${
                errorAt
                  ? 'font-semibold text-red-600'
                  : done
                  ? 'text-gray-500'
                  : active
                  ? 'font-semibold text-gray-900'
                  : 'text-gray-400'
              }`}
            >
              {stage.label}
            </p>
          </li>
        );
      })}
    </ol>
  );
}
