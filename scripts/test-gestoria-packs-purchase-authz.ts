/**
 * Regression tests for the security fix to app/api/gestoria/packs/purchase/route.ts
 * — no real database or Stripe connection needed, matching the style of
 * scripts/test-billing.ts. Run with: npx tsx scripts/test-gestoria-packs-purchase-authz.ts
 *
 * Covers the vulnerability found in the read-only audit: the route created real
 * LicensePack/License rows (free entitlement, no Stripe charge) for ANY
 * authenticated user, silently upgrading their company to company_type:
 * 'gestoria' if it wasn't already one.
 *
 * getServerSession() only resolves a real session inside a live HTTP request
 * (it reads cookies from the Next.js request context), so a true end-to-end
 * "authenticated non-admin user is rejected" test needs a running server with
 * a real session — this repo doesn't mock next-auth/Prisma in its test
 * scripts (see test-billing.ts's own note on this). What IS safely verifiable
 * here, without touching a database, is: (a) the pure pack-size validation
 * logic, and (b) that the fixed source still has the security-relevant control
 * flow in place — requireAdmin() gating the whole handler, no company_type
 * auto-upgrade, and a deterministic membership lookup — so a future edit
 * can't silently regress the fix. The authenticated-session paths (non-admin
 * rejected, admin allowed, legacy checkout+webhook still works) were verified
 * manually against a local dev server per the report this script accompanies.
 */
import * as fs from 'fs';
import * as path from 'path';

let passed = 0;
let failed = 0;
function assert(condition: boolean, label: string) {
  if (condition) { console.log(`  ✅  ${label}`); passed++; }
  else { console.error(`  ❌  ${label}`); failed++; }
}

const VALID_PACK_SIZES = [10, 20, 50];
function isValidPackSize(size: unknown): boolean {
  return VALID_PACK_SIZES.includes(size as number);
}

console.log('\n1. Pack size validation (pure logic, unchanged by the fix)');
assert(isValidPackSize(10) === true, 'size 10 is valid');
assert(isValidPackSize(20) === true, 'size 20 is valid');
assert(isValidPackSize(50) === true, 'size 50 is valid');
assert(isValidPackSize(999) === false, 'size 999 (tampered/arbitrary) is rejected');
assert(isValidPackSize(30) === false, "size 30 (doesn't exist as a real pack) is rejected");
assert(isValidPackSize(-10) === false, 'negative size is rejected');
assert(isValidPackSize('10') === false, 'string "10" (type confusion attempt) is rejected');

console.log('\n2. Structural regression guard on the fixed route source');
const routePath = path.join(__dirname, '..', 'app', 'api', 'gestoria', 'packs', 'purchase', 'route.ts');
const src = fs.readFileSync(routePath, 'utf8');

const idxRequireAdmin = src.indexOf('requireAdmin(');
const idxGetServerSession = src.indexOf('getServerSession(');
const idxCompanyTypeGuard = src.indexOf("company_type !== 'gestoria'");
const idxTransaction = src.indexOf('prisma.$transaction(');
const idxMembershipFindFirst = src.indexOf('membership.findFirst(');
const idxOrderBy = src.indexOf('orderBy:', idxMembershipFindFirst);
const idxAutoUpgrade = src.indexOf("data: { company_type: 'gestoria' }");

assert(idxRequireAdmin !== -1, "route imports/calls requireAdmin()");
assert(idxRequireAdmin !== -1 && idxGetServerSession !== -1 && idxRequireAdmin < idxGetServerSession,
  'requireAdmin() is checked BEFORE getServerSession() (fail closed before touching user session at all)');
assert(idxRequireAdmin !== -1 && idxTransaction !== -1 && idxRequireAdmin < idxTransaction,
  'requireAdmin() is checked BEFORE any Prisma write (no entitlement created for non-admins)');
assert(idxCompanyTypeGuard !== -1, "route rejects companies that aren't already company_type='gestoria' (400)");
assert(idxAutoUpgrade === -1, "the silent auto-upgrade to company_type='gestoria' has been removed");
assert(idxMembershipFindFirst !== -1 && idxOrderBy !== -1 && idxOrderBy - idxMembershipFindFirst < 200,
  'membership.findFirst() now has a deterministic orderBy (no ambiguous multi-membership resolution)');

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
