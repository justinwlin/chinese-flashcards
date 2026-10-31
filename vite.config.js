import { execSync } from 'node:child_process';
import fs from 'node:fs';
import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import { VitePWA } from 'vite-plugin-pwa';

const wordsPath = new URL('./words.json', import.meta.url);
const pkg = JSON.parse(fs.readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

function gitShortSha() {
  try {
    return execSync('git rev-parse --short=7 HEAD', { encoding: 'utf8' }).trim();
  } catch {
    return 'local';
  }
}

const buildSha = (process.env.GITHUB_SHA || gitShortSha()).slice(0, 7);
const buildTime = process.env.BUILD_TIME || new Date().toISOString();
const buildMeta = {
  version: pkg.version,
  sha: buildSha,
  builtAt: buildTime,
};

function wordsJson() {
  const load = () => fs.readFileSync(wordsPath);
  const serve = (req, res, next) => {
    const path = req.url?.split('?')[0];
    if (path === '/words.json' || path === '/chinese-flashcards/words.json') {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(load());
      return;
    }
    next();
  };
  return {
    name: 'words-json',
    configureServer(server) {
      server.middlewares.use(serve);
      return () => server.middlewares.use(serve);
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'words.json', source: load() });
      this.emitFile({
        type: 'asset',
        fileName: 'version.json',
        source: `${JSON.stringify(buildMeta, null, 2)}\n`,
      });
    },
  };
}

export default defineConfig({
  base: '/chinese-flashcards/',
  define: {
    __APP_VERSION__: JSON.stringify(buildMeta.version),
    __BUILD_SHA__: JSON.stringify(buildMeta.sha),
    __BUILD_TIME__: JSON.stringify(buildMeta.builtAt),
  },
  plugins: [
    preact(),
    wordsJson(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: false,
      includeAssets: ['favicon.svg', 'apple-touch-icon.png', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png'],
      manifest: {
        name: 'Chinese Flashcards',
        short_name: '中文卡',
        description: 'Personal Mandarin flashcards with spaced repetition.',
        lang: 'en',
        id: '/chinese-flashcards/',
        start_url: '/chinese-flashcards/',
        scope: '/chinese-flashcards/',
        display: 'standalone',
        background_color: '#141210',
        theme_color: '#141210',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,json,webmanifest,ico}'],
        navigateFallback: 'index.html',
        clientsClaim: true,
        skipWaiting: true,
        cleanupOutdatedCaches: true,
        cacheId: `chinese-flashcards-${buildSha}`,
        importScripts: ['sw-message.js'],
      },
    }),
  ],
});
