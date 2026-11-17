import 'dotenv/config';
import { loadAppConfig } from './app-config';
import { ormClientBm25TopMatches } from './orm-client/bm25-top-matches';
import { db } from './prisma/db';
import { bm25CastDemo } from './queries/bm25-cast-demo';
import { bm25ChainDemo } from './queries/bm25-chain-demo';
import { bm25Fuzzy } from './queries/bm25-fuzzy';
import { bm25Match } from './queries/bm25-match';
import { bm25ModeTour } from './queries/bm25-mode-tour';
import { bm25Proximity } from './queries/bm25-proximity';
import { bm25ProximityChain, type ProximityChainStep } from './queries/bm25-proximity-chain';
import { bm25TopByScore } from './queries/bm25-top-by-score';

function parseProximityChainArgs(args: readonly string[]): {
  readonly start: string;
  readonly steps: readonly ProximityChainStep[];
} {
  if (args.length < 3 || args.length % 2 !== 1) {
    throw new Error('Usage: pnpm start -- proximity-chain <t0> <d1> <t1> [<d2> <t2> ...]');
  }
  const [start, ...rest] = args;
  if (start === undefined) {
    throw new Error('proximity-chain: <t0> is required');
  }
  const steps: ProximityChainStep[] = [];
  for (let i = 0; i < rest.length; i += 2) {
    const distRaw = rest[i];
    const term = rest[i + 1];
    if (distRaw === undefined || term === undefined) {
      throw new Error(
        `proximity-chain: trailing distance with no following term at position ${i + 1}`,
      );
    }
    const ordered = distRaw.startsWith('>');
    const distStr = ordered ? distRaw.slice(1) : distRaw;
    const distance = Number.parseInt(distStr, 10);
    if (!Number.isInteger(distance) || distance < 0) {
      throw new Error(
        `proximity-chain: distance at position ${i + 1} must be a non-negative integer (optionally prefixed '>' for ordered); got '${distRaw}'`,
      );
    }
    steps.push({ distance, term, ordered });
  }
  return { start, steps };
}

const argv = process.argv.slice(2).filter((arg) => arg !== '--');
const [cmd, ...args] = argv;

async function main() {
  const { databaseUrl } = loadAppConfig();
  const runtime = await db.connect({ url: databaseUrl });

  try {
    if (cmd === 'match') {
      const [query, limitStr] = args;
      if (!query) {
        console.error('Usage: pnpm start -- match <query> [limit]');
        process.exit(1);
      }
      const limit = limitStr ? Number.parseInt(limitStr, 10) : 20;
      const rows = await bm25Match(query, limit);
      console.log(JSON.stringify(rows, null, 2));
    } else if (cmd === 'top') {
      const [query, limitStr] = args;
      if (!query) {
        console.error('Usage: pnpm start -- top <query> [limit]');
        process.exit(1);
      }
      const limit = limitStr ? Number.parseInt(limitStr, 10) : 10;
      const rows = await bm25TopByScore(query, limit);
      console.log(JSON.stringify(rows, null, 2));
    } else if (cmd === 'fuzzy') {
      const [term, distanceStr, limitStr] = args;
      if (!term || !distanceStr) {
        console.error('Usage: pnpm start -- fuzzy <term> <distance> [limit]');
        process.exit(1);
      }
      const distance = Number.parseInt(distanceStr, 10);
      const limit = limitStr ? Number.parseInt(limitStr, 10) : 20;
      const rows = await bm25Fuzzy(term, distance, limit);
      console.log(JSON.stringify(rows, null, 2));
    } else if (cmd === 'proximity') {
      const [term1, term2, distanceStr, limitStr] = args;
      if (!term1 || !term2 || !distanceStr) {
        console.error('Usage: pnpm start -- proximity <term1> <term2> <distance> [limit]');
        process.exit(1);
      }
      const distance = Number.parseInt(distanceStr, 10);
      const limit = limitStr ? Number.parseInt(limitStr, 10) : 20;
      const rows = await bm25Proximity(term1, term2, distance, limit);
      console.log(JSON.stringify(rows, null, 2));
    } else if (cmd === 'proximity-chain') {
      const { start, steps } = parseProximityChainArgs(args);
      const rows = await bm25ProximityChain(start, steps);
      console.log(JSON.stringify(rows, null, 2));
    } else if (cmd === 'chain-demo') {
      const rows = await bm25ChainDemo();
      console.log(JSON.stringify(rows, null, 2));
    } else if (cmd === 'mode-tour') {
      const rows = await bm25ModeTour();
      console.log(JSON.stringify(rows, null, 2));
    } else if (cmd === 'cast-demo') {
      const rows = await bm25CastDemo();
      console.log(JSON.stringify(rows, null, 2));
    } else if (cmd === 'orm-top') {
      const [query, limitStr] = args;
      if (!query) {
        console.error('Usage: pnpm start -- orm-top <query> [limit]');
        process.exit(1);
      }
      const limit = limitStr ? Number.parseInt(limitStr, 10) : 10;
      const rows = await ormClientBm25TopMatches(query, limit);
      console.log(JSON.stringify(rows, null, 2));
    } else {
      console.log(
        'Usage: pnpm start -- [match <query> [limit] | top <query> [limit] | fuzzy <term> <distance> [limit] | proximity <term1> <term2> <distance> [limit] | proximity-chain <t0> <d1> <t1> [<d2> <t2> ...] | chain-demo | mode-tour | cast-demo | orm-top <query> [limit]]',
      );
      process.exit(1);
    }
  } finally {
    await runtime.close();
  }
}

await main();
