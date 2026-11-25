// Checks one package for api-compat.mjs. The check runs on a thread of its own, which can be given
// a larger heap and stack than the process: the largest packages need more than Node's default
// heap, and TypeScript recurses deeply when it compares their types.
import { isMainThread, parentPort, Worker, workerData } from 'node:worker_threads';
import { checkPackage } from './compat.mjs';

const HEAP_MB = 8192;
const STACK_MB = 64;

const describe = (name, error) =>
  `${name}: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`;

if (isMainThread) {
  const job = JSON.parse(process.argv[2]);
  const thread = new Worker(new URL(import.meta.url), {
    workerData: job,
    resourceLimits: { maxOldGenerationSizeMb: HEAP_MB, stackSizeMb: STACK_MB },
  });
  thread.on('message', (reply) => {
    process.send(
      reply.result
        ? {
            result: {
              ...reply.result,
              maxRssMb: Math.round(process.resourceUsage().maxRSS / 1024),
            },
          }
        : reply,
    );
  });
  thread.on('error', (error) => process.send({ error: describe(job.name, error) }));
} else {
  try {
    parentPort.postMessage({ result: checkPackage(workerData) });
  } catch (error) {
    parentPort.postMessage({ error: describe(workerData.name, error) });
  }
}
