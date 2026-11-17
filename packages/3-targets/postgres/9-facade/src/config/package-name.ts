declare const __PRISMA_PUBLISHED_PACKAGE_NAME__: string | undefined;

export const packageName =
  typeof __PRISMA_PUBLISHED_PACKAGE_NAME__ === 'string'
    ? __PRISMA_PUBLISHED_PACKAGE_NAME__
    : '@internal/postgres';
