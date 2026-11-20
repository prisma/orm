# Node 22 satisfies `@prisma/streams-local`'s `engines: >=22`, which is
# required by the e2e fixtures that install it.
FROM node:22

RUN npm -v

# zx is pinned to v7 because v8 fails with:
# [esbuild Error]: Top-level await is currently not supported with the "cjs" output format
# at /usr/local/lib/node_modules/zx/build/vendor.js:2:17
# pnpm is pinned to 10.x here, deliberately behind the repo's pnpm 11
# `packageManager`: the standalone e2e projects rely on per-test `pnpm.overrides`
# in their own `package.json`, which pnpm 11 does not read (it takes overrides
# only from `pnpm-workspace.yaml`). Pinning also avoids `ERR_PNPM_IGNORED_BUILDS`
# from an unpinned pnpm, since these projects don't carry the repo's
# `onlyBuiltDependencies` config for `prisma`/`@prisma/engines`.
RUN npm i -g \
  zx@7 \
  pnpm@10.15.1 \
  typescript@5.9.3 \
  ts-node \
  esbuild \
  tsx \
  jest \
  @swc/jest@0.2.32

RUN apt update && \
  apt install iproute2 jq -y

# install Bun runtime
# Set BUN_INSTALL explicitly and add to PATH
ENV BUN_INSTALL="/root/.bun"
ENV PATH="${BUN_INSTALL}/bin:${PATH}"

# install Bun (respecting the BUN_INSTALL env var), and verify it's installed and accessible
RUN curl -fsSL https://bun.sh/install | bash && \
  ls -la ${BUN_INSTALL}/bin/bun && \
  bun --version

CMD ["bash", "./e2e/_utils/standard.cmd.sh"]
