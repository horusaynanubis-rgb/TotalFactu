// Shared value lists for "Documentación fiscal complementaria" — used by both
// the API routes (server-side validation) and the dashboard UI (selects).

export const ALLOWED_MIME_TYPES = ['application/pdf', 'image/jpeg', 'image/jpg', 'image/png'] as const;

export const FISCAL_DOCUMENT_TYPES = [
  'alquiler',
  'retenciones',
  'escritura',
  'registro_mercantil',
  'certificado_fiscal',
  'actividad',
  'tabaco',
  'profesional_notarial',
  'otro',
] as const;

export type FiscalDocumentType = (typeof FISCAL_DOCUMENT_TYPES)[number];

export const FISCAL_PERIODS = ['Q1', 'Q2', 'Q3', 'Q4', 'annual', 'none'] as const;

export type FiscalPeriod = (typeof FISCAL_PERIODS)[number];

export const FISCAL_DOCUMENT_STATUSES = ['available', 'reviewed'] as const;

export type FiscalDocumentStatus = (typeof FISCAL_DOCUMENT_STATUSES)[number];

export const FISCAL_DOCUMENT_TYPE_LABELS_ES: Record<FiscalDocumentType, string> = {
  alquiler: 'Alquiler / contrato del local',
  retenciones: 'Retenciones',
  escritura: 'Escritura de constitución',
  registro_mercantil: 'Registro Mercantil',
  certificado_fiscal: 'Certificado fiscal',
  actividad: 'Documentación de actividad',
  tabaco: 'Tabaco',
  profesional_notarial: 'Documento profesional o notarial',
  otro: 'Otro',
};

export const FISCAL_PERIOD_LABELS_ES: Record<FiscalPeriod, string> = {
  Q1: 'Q1',
  Q2: 'Q2',
  Q3: 'Q3',
  Q4: 'Q4',
  annual: 'Anual',
  none: 'Sin periodo',
};
