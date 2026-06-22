export interface ApiEnv {
  databaseUrl: string
  lineTable: string
  pointTable: string
  outputRoot: string
  host: string
  port: number
}

const DEFAULT_LINE_TABLE = 'public.sys_016_tancexbtjinfo_sde'
const DEFAULT_POINT_TABLE = 'public.sys_016_tancedbtjinfo_sde'
const DEFAULT_OUTPUT_ROOT = 'data/tiles'
const DEFAULT_HOST = '0.0.0.0'
const DEFAULT_PORT = 4100

export function readEnv(source: NodeJS.ProcessEnv = process.env): ApiEnv {
  return {
    databaseUrl: readDatabaseUrl(source),
    lineTable: source.QP3D_LINE_TABLE ?? DEFAULT_LINE_TABLE,
    pointTable: source.QP3D_POINT_TABLE ?? DEFAULT_POINT_TABLE,
    outputRoot: source.QP3D_OUTPUT_ROOT ?? DEFAULT_OUTPUT_ROOT,
    host: source.HOST ?? DEFAULT_HOST,
    port: readPort(source.PORT),
  }
}

function readDatabaseUrl(source: NodeJS.ProcessEnv): string {
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
