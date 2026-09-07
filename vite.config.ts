import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { createRequire } from 'node:module'

const { version: APP_VERSION } = createRequire(import.meta.url)('./package.json')

const VENDOR_CHUNK_RULES: Array<{ chunk: string; packages: string[] }> = [
  {
    chunk: 'vendor-react',
    packages: ['react', 'react-dom', 'react-router-dom'],
  },
  {
    chunk: 'vendor-editor',
    packages: ['@tiptap'],
  },
  {
    chunk: 'vendor-ui',
    packages: ['lucide-react', '@radix-ui'],
  },
  {
    chunk: 'vendor-audio',
    packages: ['tone'],
  },
  {
    chunk: 'vendor-utils',
    packages: ['jszip', 'pdf-lib'],
  },
]

function resolveManualChunk(id: string): string | undefined {
  if (!id.includes('/node_modules/')) return undefined

  const modulePath = id.split('/node_modules/')[1]
  if (!modulePath) return undefined

  for (const rule of VENDOR_CHUNK_RULES) {
    if (rule.packages.some((pkg) => id.includes(`/node_modules/${pkg}/`) || id.includes(`/node_modules/${pkg}`))) {
      return rule.chunk
    }
  }

  const pathSegments = modulePath.split('/')
  const packageName = pathSegments[0]?.startsWith('@')
    ? `${pathSegments[0]}/${pathSegments[1] ?? ''}`
    : pathSegments[0]

  if (!packageName) return undefined

  return `vendor-${packageName.replace('@', '').replace('/', '-')}`
}

function resolveProxyUri() {
  const proxyUriTemplate = process.env.VSCODE_PROXY_URI
  if (!proxyUriTemplate) return null

  const devPort = process.env.PORT ?? '5173'
  return proxyUriTemplate.includes('{{port}}')
    ? proxyUriTemplate.replace('{{port}}', devPort)
    : proxyUriTemplate
}

function resolveDevBaseFromProxyUri() {
  const proxyUri = resolveProxyUri()
  if (!proxyUri) return null

  try {
    return new URL(proxyUri).pathname || '/'
  } catch {
    return null
  }
}

function resolveAllowedHostFromProxyUri() {
  const proxyUri = resolveProxyUri()
  if (!proxyUri) return null

  try {
    return new URL(proxyUri).host
  } catch {
    return null
  }
}

// A public dev origin served by a dedicated subdomain reverse-proxied straight to Vite
// (no path prefix) — e.g. `VITE_DEV_ORIGIN=https://test.example.com npm run dev`. When set,
// the dev server uses base '/', trusts that host, and points the HMR websocket at it so
// live reload works through the proxy's TLS.
function resolveDevOrigin() {
  if (!process.env.VITE_DEV_ORIGIN) return null
  try {
    return new URL(process.env.VITE_DEV_ORIGIN)
  } catch {
    return null
  }
}

// Set base to './' for GitHub Pages subdirectory deployment.
// Override with VITE_BASE env var if deploying to a custom domain root.
const devOrigin = resolveDevOrigin()

export default defineConfig(({ command }) => ({
  define: {
    __APP_VERSION__: JSON.stringify(APP_VERSION),
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: [
        'icon.png',
      ],
      manifest: {
        name: 'GIGBOY',
        short_name: 'GIGBOY',
        description: 'Your songs. Your stage.',

        theme_color: '#1a6fc4',
        background_color: '#ffffff',
        display: 'standalone',
        scope: './',
        start_url: './',
        orientation: 'portrait',
        icons: [
          {
            src: 'icon.png',
            sizes: '372x372',
            type: 'image/png',
            purpose: 'any',
          },
        ],
      },
      workbox: {
        cleanupOutdatedCaches: true,
        globPatterns: ['**/*.{js,css,html,ico,png,svg,webp,woff2}'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [
          {
            // Cache regular JSON API GETs, but never the SSE session stream (an infinite
            // text/event-stream Workbox would try to clone and buffer) or recording
            // downloads (Range / 206 partial responses must not be cached or reassembled
            // by the service worker). Both misbehave badly in the installed PWA.
            urlPattern: ({ url, request }) =>
              url.pathname.startsWith('/api/')
              && request.method === 'GET'
              && !url.pathname.endsWith('/session/stream')
              && !/\/recordings\/[^/]+\/download$/.test(url.pathname),
            handler: 'NetworkFirst',
            options: {
              cacheName: 'api-cache',
              networkTimeoutSeconds: 10,
              expiration: {
                maxEntries: 100,
                maxAgeSeconds: 60 * 60 * 24,
              },
            },
          },
          {
            urlPattern: ({ request }) => request.destination === 'document',
            handler: 'NetworkFirst',
            options: {
              cacheName: 'html-cache',
              networkTimeoutSeconds: 3,
              expiration: {
                maxEntries: 20,
                maxAgeSeconds: 60 * 60 * 24,
              },
            },
          },
        ],
      },
      devOptions: {
        // Avoid noisy dev-only SW registration and no-op fetch warnings.
        enabled: false,
      },
    }),
  ],
  // In Docker + browser VS Code, dev URLs are commonly exposed via a proxy path.
  // Applies to `build` too so a local `npm run build` + `server:dev` preview (single-origin,
  // no dev-server API proxy) resolves assets correctly. VSCODE_PROXY_URI is only set inside
  // the code-server container, so real production builds (e.g. the Docker image) are unaffected
  // and still fall back to '/'. Override with VITE_DEV_BASE if your proxy path differs.
  base:
    process.env.VITE_BASE ??
    (command === 'serve'
      ? (devOrigin ? '/' : (process.env.VITE_DEV_BASE ?? resolveDevBaseFromProxyUri() ?? '/'))
      : (resolveDevBaseFromProxyUri() ?? '/')),
  server: {
    host: true,
    allowedHosts: Array.from(
      new Set([
        'localhost',
        '127.0.0.1',
        'code.manriquez.no',
        ...(devOrigin ? [devOrigin.hostname] : []),
        ...(process.env.VITE_DEV_HOST ? [process.env.VITE_DEV_HOST] : []),
        ...(resolveAllowedHostFromProxyUri() ? [resolveAllowedHostFromProxyUri() as string] : []),
      ]),
    ),
    ...(devOrigin
      ? {
        hmr: {
          host: devOrigin.hostname,
          protocol: devOrigin.protocol === 'https:' ? 'wss' : 'ws',
          clientPort: devOrigin.port
            ? Number(devOrigin.port)
            : (devOrigin.protocol === 'https:' ? 443 : 80),
        },
      }
      : {}),
  },
  test: {
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: resolveManualChunk,
      },
    },
  },
}))
