// Copyright 2026 CRMy Contributors
// SPDX-License-Identifier: Apache-2.0

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  base: '/app/',
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3001',
      '/auth': 'http://localhost:3001',
      '/health': 'http://localhost:3001',
    },
  },
  build: {
    outDir: 'dist',
  },
});
