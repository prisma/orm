# Large Schema Generation E2E Test

This e2e test validates that `prisma generate` can fall back to buffered DMMF parsing
for very large schemas (> 512MB DMMF).
