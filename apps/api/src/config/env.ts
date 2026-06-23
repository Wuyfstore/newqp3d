import { isAbsolute, resolve } from 'node:path'

import { loadRuntimeConfig, QP3D_WORKSPACE_ROOT } from '@new-qp3d/runtime-config'

export interface ApiEnv {
  databaseUrl: string
  lineTable: string
  pointTable: string
  outputRoot: string
  accessControlEnabled: boolean
  host: string
  port: number
}

const DEFAULT_LINE_TABLE = 'public.sys_016_tancexbtjinfo_sde'
const DEFAULT_POINT_TABLE = 'public.sys_016_tancedbtjinfo_sde'
const DEFAULT_OUTPUT_ROOT = 'data/tiles'
const DEFAULT_HOST = '0.0.0.0'
const DEFAULT_PORT = 4100

export interface ReadEnvOptions {
  cwd?: string
  processEnv?: Record<string, string | undefined>
}

export function readEnv(source: NodeJS.ProcessEnv = process.env, options: ReadEnvOptions = {}): ApiEnv {
  const config = loadRuntimeConfig({
    env: options.processEnv ?? process.env,
    overrides: source,
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
  })

  return {
    databaseUrl: readDatabaseUrl(config),
    lineTable: config.QP3D_LINE_TABLE ?? DEFAULT_LINE_TABLE,
    pointTable: config.QP3D_POINT_TABLE ?? DEFAULT_POINT_TABLE,
    outputRoot: resolveOutputRoot(config.QP3D_OUTPUT_ROOT ?? DEFAULT_OUTPUT_ROOT, config[QP3D_WORKSPACE_ROOT]),
    accessControlEnabled: readBoolean(config.QP3D_ACCESS_CONTROL_ENABLED),
    host: config.HOST ?? DEFAULT_HOST,
    port: readPort(config.PORT),
  }
}

function readDatabaseUrl(source: Record<string, string | undefined>): string {
  const value = source.QP3D_DATABASE_URL?.trim() || source.DATABASE_URL?.trim()
  if (!value) {
    throw new Error('QP3D_DATABASE_URL or DATABASE_URL is required')
  }

  return value
}

function readPort(value: string | undefined): number {
  if (value == null || value.trim() === '') {
    return DEFAULT_PORT
  }

  const port = Number(value)
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`Invalid PORT: ${value}`)
  }

  return port
}

function readBoolean(value: string | undefined): boolean {
  if (value == null || value.trim() === '') {
    return false
  }

  const normalized = value.trim().toLowerCase()
  if (normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'on') {
    return true
  }
  if (normalized === 'false' || normalized === '0' || normalized === 'no' || normalized === 'off') {
    return false
  }

  throw new Error(`Invalid boolean value: ${value}`)
}

function resolveOutputRoot(outputRoot: string, workspaceRoot: string | undefined): string {
  return isAbsolute(outputRoot) ? outputRoot : resolve(workspaceRoot ?? process.cwd(), outputRoot)
}
