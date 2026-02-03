import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: true,
  clean: true,
  noExternal: [
    '@zkagi/openpaw-detect',
    '@zkagi/openpaw-vault',
    '@zkagi/openpaw-scanner',
    '@zkagi/openpaw-migrate',
  ],
  banner: {
    js: '#!/usr/bin/env node',
  },
});
