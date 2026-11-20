import { defineConfig, env } from "@prisma/config";
import 'dotenv/config';

export default defineConfig({
  datasource: {
    url: 'file:prisma/dev.db',
  }
})
