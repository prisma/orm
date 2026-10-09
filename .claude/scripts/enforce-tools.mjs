#!/usr/bin/env node

import { text } from 'node:stream/consumers';

const input = JSON.parse(await text(process.stdin));
const command = input.tool_input?.command ?? '';

const FULL_SUITE_REASON =
  'Never run the full integration or e2e suites locally; run the test files your change touches (pnpm test <paths> inside the package) and leave the full suites to CI';

const rules = [
  { pattern: /\bnpm(\s|$)/, reason: 'Use pnpm, not npm' },
  { pattern: /\bnpx(\s|$)/, reason: 'Use pnpm, not npx' },
  {
    pattern: /\bpnpm (exec )?tsc(\s|$)/,
    reason: "Use 'pnpm typecheck' instead of running tsc directly",
  },
  {
    pattern: /\bpnpm (exec )?biome(\s|$)/,
    reason: "Use 'pnpm lint' instead of running biome directly",
  },
  {
    pattern: /\bpnpm (exec )?vitest(\s|$)/,
    reason: "Use 'pnpm test' instead of running vitest directly",
  },
  {
    pattern: /\bpnpm (run )?test:(integration|e2e|all)(:agent)?(\s|$)/,
    reason: FULL_SUITE_REASON,
  },
  {
    pattern: /\bpnpm\s+(-r|--recursive|-w|--workspace-root|--filter\s+(integration-tests|e2e-tests))\s+(run\s+)?test(\s|$)/,
    reason: FULL_SUITE_REASON,
  },
  { pattern: /\bturbo run test(\s|$)/, reason: FULL_SUITE_REASON },
  {
    pattern: /test\/integration.*\bpnpm (run )?test\s*($|[;&|>)])/,
    reason: FULL_SUITE_REASON,
  },
];

for (const { pattern, reason } of rules) {
  if (pattern.test(command)) {
    console.log(JSON.stringify({ decision: 'block', reason }));
    process.exit(0);
  }
}
