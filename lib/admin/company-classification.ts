import { INTERNAL_COMPANY_TYPE } from "./platform-admin";

export type CompanyBucket = "interna" | "beta" | "gestoria" | "grupo" | "pago";

export type PaymentStatusLabel =
  | "Activa"
  | "Beta"
  | "Pago pendiente"
  | "Cancelada"
  | "Inactiva"
  | "Interna"
  | "Sin suscripción";

export interface ClassifiableCompany {
  company_type: string;
  is_beta: boolean;
}

/**
 * Buckets a company into exactly one category, in priority order, so a
 * company is never counted twice across the "distribución de clientes"
 * chart or the companies-list filters (see plan section 14 — "No contar dos
 * veces una empresa por pertenecer a un grupo").
 *
 * `isPartOfGroup` = the owning user has more than one Membership (see
 * hasMultipleCompanies in components/dashboard-nav.tsx for the precedent of
 * this same "grupo empresarial" concept).
 */
export function classifyCompanyBucket(
  company: ClassifiableCompany,
  isPartOfGroup: boolean,
): CompanyBucket {
  if (company.company_type === INTERNAL_COMPANY_TYPE) return "interna";
  if (company.is_beta) return "beta";
  if (company.company_type === "gestoria") return "gestoria";
  if (isPartOfGroup) return "grupo";
  return "pago";
}

export interface SubscriptionLike {
  status: string;
  plan_name: string;
}

/**
 * Read-only label derived from local Subscription rows synced by the Stripe
 * webhook (app/api/webhooks/stripe/route.ts) — never calls Stripe directly.
 */
export function getPaymentStatusLabel(
  company: ClassifiableCompany,
  subscription: SubscriptionLike | null,
): PaymentStatusLabel {
  if (company.company_type === INTERNAL_COMPANY_TYPE) return "Interna";
  if (company.is_beta) return "Beta";
  if (!subscription) return "Sin suscripción";
  switch (subscription.status) {
    case "active":
      return "Activa";
    case "past_due":
      return "Pago pendiente";
    case "cancelled":
      return "Cancelada";
    case "inactive":
      return "Inactiva";
    default:
      return "Sin suscripción";
  }
}
