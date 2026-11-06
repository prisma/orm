/// <reference types="@cloudflare/vitest-pool-workers/types" />

declare namespace Cloudflare {
  interface Env {
    HYPERDRIVE: { connectionString: string };
  }
}
