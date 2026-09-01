Issue #27059: a model extension that calls `Prisma.getExtensionContext(this).findMany(...)`
with a model-specific args type should not hit TypeScript's excessive stack depth error on
large schemas.
