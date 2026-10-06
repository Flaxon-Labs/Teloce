import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      // `vscode` only exists inside the extension host; tests use a fake.
      vscode: fileURLToPath(new URL('./__mocks__/vscode.ts', import.meta.url)),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.spec.ts'],
    // Real TypeScript language-service runs; give the first one room to warm up.
    testTimeout: 20000,
  },
});
