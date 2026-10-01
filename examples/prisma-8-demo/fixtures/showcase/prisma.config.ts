import { definePrismaConfig } from '@prisma/cli-engine';
import { defineConfig as ormConfig } from '@prisma/orm-postgres/config';

// Showcase fixture config — a deliberately comprehensive migration graph that
// exercises every shape the `migration graph` renderer handles: a linear spine,
// diamond divergence/convergence, a forward cross-link, adjacent and
// node-skipping routed rollbacks, converging node-skipping rollbacks (multiple
// back-arcs landing on one node), a self-edge, a disjoint cyclic component, and
// a branch node with a second forward child (multi-lane merge landing on a
// non-trunk lane plus the connector crossing it creates).
//
// Explore it from the CLI:
//   pnpm exec prisma migration graph --config ./fixtures/showcase/prisma.config.ts
export default definePrismaConfig({
  orm: ormConfig({
    contract: './contract.prisma',
    db: {
      connection: 'postgresql://showcase:showcase@localhost:5432/showcase',
    },
    migrations: {
      dir: './migrations',
    },
  }),
});
