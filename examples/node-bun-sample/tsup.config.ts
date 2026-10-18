import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: false,
  clean: true,
  sourcemap: true,
  target: 'node18',
  noExternal: ['@tracex-dev/core', '@tracex-dev/node'],
});
