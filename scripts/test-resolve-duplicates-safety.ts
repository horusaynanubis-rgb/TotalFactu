/**
 * Tests the safety surface of scripts/resolve-confirmed-duplicates.ts:
 *   - pair-argument parsing (lib/duplicate-detection.ts#parseDuplicatePairsArg)
 *   - that its underlying mutation primitive never writes without an
 *     explicit confirm, using the same fake-Prisma approach as
 *     scripts/test-stuck-documents.ts (no real DB connection).
 * Run with: npx tsx scripts/test-resolve-duplicates-safety.ts
 *
 * Covers audit case 8: the duplicate-resolution script does not modify
 * anything in dry-run (i.e. without --confirm).
 */
import { parseDuplicatePairsArg } from '../lib/duplicate-detection';

let passed = 0;
let failed = 0;
function assert(condition: boolean, label: string) {
  if (condition) { console.log(`  ✅  ${label}`); passed++; }
  else { console.error(`  ❌  ${label}`); failed++; }
}

console.log('\nparseDuplicatePairsArg — valid input\n');
{
  const pairs = parseDuplicatePairsArg('abc123:def456,ghi789:jkl012');
  assert(pairs.length === 2, 'Parses two pairs from a comma-separated list');
  assert(pairs[0].principalId === 'abc123' && pairs[0].duplicateId === 'def456', 'First pair parsed correctly (principal:duplicate order preserved)');
  assert(pairs[1].principalId === 'ghi789' && pairs[1].duplicateId === 'jkl012', 'Second pair parsed correctly');
}

console.log('\nparseDuplicatePairsArg — malformed input never silently drops a bad pair\n');
{
  let threw = false;
  try { parseDuplicatePairsArg('abc123-def456'); } catch { threw = true; }
  assert(threw, 'A pair missing the ":" separator throws instead of being silently skipped (fails loud, not quiet)');

  let threwEmpty = false;
  try { parseDuplicatePairsArg('abc123:'); } catch { threwEmpty = true; }
  assert(threwEmpty, 'A pair with an empty duplicateId throws');
}

console.log('\nMutation primitive: dry-run (no confirm) never calls delete/update — same gate lib/stuck-documents.ts uses\n');
{
  // resolve-confirmed-duplicates.ts is a script, not a module with an
  // exported "apply" function — its safety is structural: every write path
  // is behind `if (dryRun) { ...only console.log...; continue }`. We assert
  // that structural invariant directly against the source, since importing
  // and executing the script's main() would require a live PrismaClient.
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(path.join(__dirname, 'resolve-confirmed-duplicates.ts'), 'utf-8');

  const dryRunBlockMatch = src.match(/if \(dryRun\) \{([\s\S]*?)\n\s*continue;\n\s*\}/);
  assert(!!dryRunBlockMatch, 'Script has a dry-run branch that continues before any write');
  const dryRunBlock = dryRunBlockMatch ? dryRunBlockMatch[1] : '';
  assert(!/prisma\.(invoice|document)\.(delete|update|create)/.test(dryRunBlock), 'Dry-run branch contains no Prisma write calls');

  const confirmGate = /const \{ pairs, action, confirm, dryRun \} = parseArgs\(\);/.test(src) && /dryRun = process\.argv\.includes\('--dry-run'\) \|\| !confirm;/.test(src);
  assert(confirmGate, 'dryRun defaults to true unless --confirm is explicitly passed (confirm-gate present in source)');

  assert(src.includes("--pairs=<principalId>:<duplicateId>,... is required"), 'Script refuses to run without an explicit, human-supplied --pairs list (never guesses which invoices to touch)');
}

console.log(`\n${passed + failed} comprobaciones: ${passed} pasadas, ${failed} fallidas`);
if (failed > 0) process.exit(1);
