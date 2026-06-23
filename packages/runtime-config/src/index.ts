import { existsSync, readFileSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'

export type RuntimeConfig = Record<string, string | undefined>

export interface LoadRuntimeConfigOptions {
  cwd?: string
  env?: RuntimeConfig
  overrides?: RuntimeConfig
  defaultConfigPath?: string
}

const DEFAULT_CONFIG_PATH = 'config/backend.env'
export const QP3D_WORKSPACE_ROOT = 'QP3D_WORKSPACE_ROOT'

export function loadRuntimeConfig(options: LoadRuntimeConfigOptions = {}): RuntimeConfig {
  const cwd = options.cwd ?? process.cwd()
  const env = options.env ?? process.env
  const workspaceRoot = findWorkspaceRoot(cwd)
  const configPath = resolveConfigPath(cwd, env, options.defaultConfigPath ?? DEFAULT_CONFIG_PATH, workspaceRoot)
  const fileConfig = configPath && existsSync(configPath)
    ? parseRuntimeConfig(readFileSync(configPath, 'utf8'))
    : {}

  return {
    [QP3D_WORKSPACE_ROOT]: workspaceRoot,
    ...fileConfig,
    ...compact(env),
    ...compact(options.overrides ?? {}),
  }
}

export function parseRuntimeConfig(source: string): RuntimeConfig {
  const config: RuntimeConfig = {}

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
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      continue
    }

    config[key] = unquote(line.slice(separator + 1).trim())
  }

  return config
}

function resolveConfigPath(
  cwd: string,
  env: RuntimeConfig,
  defaultConfigPath: string,
  workspaceRoot: string,
): string | undefined {
  const explicitPath = env.QP3D_CONFIG_FILE?.trim()
  if (explicitPath) {
    return isAbsolute(explicitPath) ? explicitPath : resolve(cwd, explicitPath)
  }

  return resolve(workspaceRoot, defaultConfigPath)
}

function findWorkspaceRoot(start: string): string {
  let current = resolve(start)
  let nearestPackageRoot: string | undefined

  while (true) {
    if (
      existsSync(join(current, 'pnpm-workspace.yaml'))
      || existsSync(join(current, '.git'))
    ) {
      return current
    }

    if (!nearestPackageRoot && existsSync(join(current, 'package.json'))) {
      nearestPackageRoot = current
    }

    const parent = dirname(current)
    if (parent === current) {
      return nearestPackageRoot ?? resolve(start)
    }
    current = parent
  }
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

function compact(source: RuntimeConfig): RuntimeConfig {
  const values: RuntimeConfig = {}
  for (const [key, value] of Object.entries(source)) {
    if (value !== undefined) {
      values[key] = value
    }
  }
  return values
}
