export interface PipelineConfig {
  databaseUrl: string
  pointTable: string
  lineTable: string
  expectedSrid: number
  outputRoot: string
}

export function loadPipelineConfig(env: Record<string, string | undefined>): PipelineConfig {
  const databaseUrl = env.QP3D_DATABASE_URL
  if (!databaseUrl) {
    throw new Error('QP3D_DATABASE_URL is required')
  }

  const expectedSrid = Number(env.QP3D_EXPECTED_SRID ?? 3857)
  if (!Number.isInteger(expectedSrid)) {
    throw new Error('QP3D_EXPECTED_SRID must be an integer')
  }

  return {
    databaseUrl,
    pointTable: env.QP3D_POINT_TABLE ?? 'public.sys_016_tancedbtjinfo_sde',
    lineTable: env.QP3D_LINE_TABLE ?? 'public.sys_016_tancexbtjinfo_sde',
    expectedSrid,
    outputRoot: env.QP3D_OUTPUT_ROOT ?? 'data/tiles',
  }
}
