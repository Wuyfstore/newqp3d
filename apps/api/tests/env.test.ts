import { describe, expect, it } from 'vitest'

import { readEnv } from '../src/config/env.js'

describe('readEnv', () => {
  it('accepts QP3D_DATABASE_URL for consistency with pipeline configuration', () => {
    expect(readEnv({
      QP3D_DATABASE_URL: 'postgres://example.invalid/qp3d',
    }).databaseUrl).toBe('postgres://example.invalid/qp3d')
  })

  it('uses the PRD source tables by default', () => {
    expect(readEnv({
      QP3D_DATABASE_URL: 'postgres://example.invalid/qp3d',
    })).toMatchObject({
      lineTable: 'public.sys_016_tancexbtjinfo_sde',
      pointTable: 'public.sys_016_tancedbtjinfo_sde',
    })
  })
})
