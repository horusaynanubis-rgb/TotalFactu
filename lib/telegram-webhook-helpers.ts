// Small, pure helpers extracted out of app/api/webhooks/telegram/route.ts so
// they're unit-testable and don't trip Next.js's route-file export
// validation (a route.ts file may only export the HTTP method handlers and
// a small fixed set of config values — any other export fails `tsc`).

// process/route.ts's own catch block always sends the user a specific
// Telegram message whenever it has a Document to attach telegram_chat_id
// to — which is every case except "the document row itself doesn't exist"
// (404, e.g. it was deleted between creation and the process call).
export function shouldWebhookSendFallbackMessage(processResponseStatus: number): boolean {
  return processResponseStatus === 404;
}
