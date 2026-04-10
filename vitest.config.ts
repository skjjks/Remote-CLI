import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/index.ts']
    }
  },
  resolve: {
    alias: {
      // The driver imports '@opencode-ai/sdk/dist/index' to bypass TS
      // moduleResolution limitations, but Vite enforces the package exports
      // field which only exposes '.'. Map the deep path to the root entry.
      '@opencode-ai/sdk/dist/index': '@opencode-ai/sdk',
    },
  },
});
