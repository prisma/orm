import { defineConfig, env } from "@prisma/config";
import 'dotenv/config';

export default defineConfig({
  datasource: {
    url: env('TEST_POSTGRES_URI'),
  }
})
