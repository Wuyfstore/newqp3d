import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs'
import { cp, rm } from 'node:fs/promises'
import { extname, isAbsolute, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { defineConfig, type Plugin } from 'vite'

const cesiumBaseUrl = '/cesium'
const webRoot = fileURLToPath(new URL('.', import.meta.url))
const workspaceRoot = resolve(webRoot, '../..')
const cesiumSourceRoot = resolve(
  webRoot,
  'node_modules/cesium/Build/Cesium',
)
const cesiumStaticDirs = ['Assets', 'ThirdParty', 'Workers', 'Widgets'] as const
const backendDevSettings = readBackendDevSettings({ workspaceRoot })

export default defineConfig({
  define: {
    CESIUM_BASE_URL: JSON.stringify(cesiumBaseUrl),
  },
  server: {
    proxy: {
      '/api': {
        target: backendDevSettings.apiOrigin,
        changeOrigin: true,
      },
    },
  },
  plugins: [
    staticAssetMiddleware({
      name: 'qp3d-cesium-static-assets',
      baseUrl: cesiumBaseUrl,
      root: cesiumSourceRoot,
    }),
    staticAssetMiddleware({
      name: 'qp3d-tile-static-assets',
      baseUrl: '/tiles',
      root: backendDevSettings.tileRoot,
    }),
    copyCesiumStaticAssets(),
  ],
})

export interface BackendDevSettings {
  apiOrigin: string
  tileRoot: string
}

export interface ReadBackendDevSettingsOptions {
  env?: Record<string, string | undefined>
  workspaceRoot?: string
}

export function readBackendDevSettings(options: ReadBackendDevSettingsOptions = {}): BackendDevSettings {
  const root = resolve(options.workspaceRoot ?? workspaceRoot)
  const env = options.env ?? process.env
  const config = {
    ...readBackendConfig(root, env),
    ...compact(env),
  }

  return {
    apiOrigin: `http://${normalizeBackendHost(config.HOST)}:${readPort(config.PORT)}`,
    tileRoot: resolveConfigPath(config.QP3D_OUTPUT_ROOT ?? 'data/tiles', root),
  }
}

interface StaticAssetMiddlewareOptions {
  name: string
  baseUrl: string
  root: string
}

function staticAssetMiddleware(options: StaticAssetMiddlewareOptions): Plugin {
  return {
    name: options.name,
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const requestUrl = request.url ?? '/'
        if (!requestUrl.startsWith(`${options.baseUrl}/`)) {
          next()
          return
        }

        try {
          const url = new URL(requestUrl, 'http://127.0.0.1')
          const filePath = resolveStaticPath(url.pathname, options.baseUrl, options.root)
          const stats = statSync(filePath)

          if (!stats.isFile()) {
            sendNotFound(response)
            return
          }

          response.setHeader('Content-Type', contentType(filePath))
          createReadStream(filePath).pipe(response)
        } catch {
          sendNotFound(response)
        }
      })
    },
  }
}

function copyCesiumStaticAssets(): Plugin {
  let outDir = ''

  return {
    name: 'qp3d-copy-cesium-static-assets',
    apply: 'build',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir)
    },
    async closeBundle() {
      const targetRoot = ensureInside(resolve(outDir, trimLeadingSlash(cesiumBaseUrl)), outDir)

      await rm(targetRoot, { recursive: true, force: true })
      for (const dir of cesiumStaticDirs) {
        await cp(
          resolve(cesiumSourceRoot, dir),
          ensureInside(resolve(targetRoot, dir), targetRoot),
          { recursive: true },
        )
      }
    },
  }
}

function readBackendConfig(root: string, env: Record<string, string | undefined>): Record<string, string | undefined> {
  const configPath = env.QP3D_CONFIG_FILE?.trim()
    ? resolveConfigPath(env.QP3D_CONFIG_FILE, root)
    : resolve(root, 'config/backend.env')

  return existsSync(configPath)
    ? parseEnvFile(readFileSync(configPath, 'utf8'))
    : {}
}

function parseEnvFile(source: string): Record<string, string | undefined> {
  const config: Record<string, string | undefined> = {}

  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) {
      continue
    }

    const separator = line.indexOf('=')
    if (separator <= 0) {
      continue
    }

    const key = line.slice(0, separator).trim()
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      config[key] = unquote(line.slice(separator + 1).trim())
    }
  }

  return config
}

function readPort(value: string | undefined): number {
  const port = Number(value ?? 4100)
  return Number.isInteger(port) && port > 0 && port <= 65535 ? port : 4100
}

function normalizeBackendHost(value: string | undefined): string {
  const host = value?.trim()
  return !host || host === '0.0.0.0' || host === '::' ? '127.0.0.1' : host
}

function resolveConfigPath(path: string, root: string): string {
  return isAbsolute(path) ? path : resolve(root, path)
}

function resolveStaticPath(pathname: string, baseUrl: string, root: string): string {
  const relativePath = decodeURIComponent(pathname)
    .replace(new RegExp(`^${baseUrl}/`), '')
    .replace(/^\/+/, '')
  return ensureInside(resolve(root, relativePath), root)
}

function ensureInside(filePath: string, root: string): string {
  const resolvedRoot = resolve(root)
  const resolvedPath = resolve(filePath)
  const relativePath = relative(resolvedRoot, resolvedPath)

  if (relativePath.startsWith('..') || isAbsolute(relativePath)) {
    throw new Error(`Path escapes static root: ${filePath}`)
  }

  return resolvedPath
}

function trimLeadingSlash(value: string): string {
  return value.replace(/^\/+/, '')
}

function sendNotFound(response: { statusCode: number, end: (message: string) => void }): void {
  response.statusCode = 404
  response.end('Not found')
}

function unquote(value: string): string {
  if (value.length >= 2) {
    const quote = value[0]
    if ((quote === '"' || quote === '\'') && value[value.length - 1] === quote) {
      return value.slice(1, -1)
    }
  }

  return value
}

function compact(source: Record<string, string | undefined>): Record<string, string | undefined> {
  const values: Record<string, string | undefined> = {}
  for (const [key, value] of Object.entries(source)) {
    if (value !== undefined) {
      values[key] = value
    }
  }
  return values
}

function contentType(filePath: string): string {
  const types = new Map([
    ['.css', 'text/css; charset=utf-8'],
    ['.gif', 'image/gif'],
    ['.jpg', 'image/jpeg'],
    ['.jpeg', 'image/jpeg'],
    ['.js', 'text/javascript; charset=utf-8'],
    ['.json', 'application/json; charset=utf-8'],
    ['.png', 'image/png'],
    ['.svg', 'image/svg+xml'],
    ['.wasm', 'application/wasm'],
    ['.xml', 'application/xml; charset=utf-8'],
  ])

  return types.get(extname(filePath).toLowerCase()) ?? 'application/octet-stream'
}
