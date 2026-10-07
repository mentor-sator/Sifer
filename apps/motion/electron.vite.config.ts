import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'electron-vite';
import type { Plugin } from 'vite';
import { contentSecurityPolicy, cspPlaceholder } from './src/shared/csp';

function siferContentSecurityPolicy(): Plugin {
  return {
    name: 'sifer-content-security-policy',
    transformIndexHtml: {
      order: 'post',
      handler(html, context) {
        return html.replace(cspPlaceholder, contentSecurityPolicy(Boolean(context.server)));
      },
    },
  };
}

export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/main/index.ts'),
          'reader-worker': resolve('src/main/reader/worker.ts'),
        },
      },
    },
  },
  preload: {
    build: {
      rollupOptions: {
        output: { format: 'cjs', entryFileNames: '[name].cjs' },
      },
    },
  },
  renderer: {
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/renderer/index.html'),
          orb: resolve('src/renderer/orb.html'),
          panel: resolve('src/renderer/panel.html'),
        },
      },
    },
    plugins: [react(), siferContentSecurityPolicy()],
  },
});
