import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@adorema/shared': r('./packages/shared/src/index.ts'),
      '@adorema/domain': r('./packages/domain/src/index.ts'),
      '@adorema/db': r('./packages/db/src/index.ts'),
      '@adorema/aplicacion': r('./packages/aplicacion/src/index.ts'),
    },
  },
  test: {
    testTimeout: 60_000,
    include: ['packages/**/*.test.ts', 'apps/**/*.test.{ts,js}'],
  },
});
