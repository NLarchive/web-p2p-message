import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    setupFiles: ['./tests/setup.js'],
    exclude: ['tests/e2e/**', 'node_modules/**'],
  },
});
