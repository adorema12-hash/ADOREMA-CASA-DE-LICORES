import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/index.ts',
  out: './migraciones',
  casing: 'snake_case',
  verbose: true,
  strict: true,
});
