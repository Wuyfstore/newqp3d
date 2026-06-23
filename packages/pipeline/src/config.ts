import { isAbsolute, resolve } from 'node:path'

import { loadRuntimeConfig, QP3D_WORKSPACE_ROOT } from '@new-qp3d/runtime-config'
import type { BuildTemplate } from '@new-qp3d/shared'

export interface PipelineConfig {
  databaseUrl: string
  pointTable: string
  lineTable: string
  expectedSrid: number
  outputRoot: string
  template?: BuildTemplate
  tileOptions?: {
    maxFeaturesPerTile: number
    maxDepth: number
    maxTileBytes: number
    radialSegments: number
  }
}

export interface LoadPipelineConfigOptions {
  cwd?: string
  processEnv?: Record<string, string | undefined>
}

export function loadPipelineConfig(
  env: Record<string, string | undefined> = process.env,
  options: LoadPipelineConfigOptions = {},
): PipelineConfig {
  const runtimeConfig = loadRuntimeConfig({
    env: options.processEnv ?? process.env,
    overrides: env,
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
  })
  const databaseUrl = runtimeConfig.QP3D_DATABASE_URL
  if (!databaseUrl) {
    throw new Error('QP3D_DATABASE_URL is required')
  }

  const expectedSrid = Number(runtimeConfig.QP3D_EXPECTED_SRID ?? 3857)
  if (!Number.isInteger(expectedSrid)) {
    throw new Error('QP3D_EXPECTED_SRID must be an integer')
  }

  return {
    databaseUrl,
    pointTable: runtimeConfig.QP3D_POINT_TABLE ?? 'public.sys_016_tancedbtjinfo_sde',
    lineTable: runtimeConfig.QP3D_LINE_TABLE ?? 'public.sys_016_tancexbtjinfo_sde',
    expectedSrid,
    outputRoot: resolveOutputRoot(runtimeConfig.QP3D_OUTPUT_ROOT ?? 'data/tiles', runtimeConfig[QP3D_WORKSPACE_ROOT]),
  }
}

function resolveOutputRoot(outputRoot: string, workspaceRoot: string | undefined): string {
  return isAbsolute(outputRoot) ? outputRoot : resolve(workspaceRoot ?? process.cwd(), outputRoot)
}
