import { checkPackage } from './compat.mjs';

const job = JSON.parse(process.argv[2]);
try {
  const result = checkPackage(job);
  process.send({
    result: { ...result, maxRssMb: Math.round(process.resourceUsage().maxRSS / 1024) },
  });
} catch (error) {
  process.send({
    error: `${job.name}: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`,
  });
}
