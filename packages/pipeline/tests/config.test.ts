import { mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { loadPipelineConfig } from '../src/config.js'

describe('loadPipelineConfig', () => {
  it('loads PostGIS build configuration from config/backend.env', async () => {
    const root = await createWorkspace()
    await writeFile(join(root, 'config', 'backend.env'), [
      'QP3D_DATABASE_URL=postgres://file.example/qp3d',
      'QP3D_LINE_TABLE=public.file_line',
      'QP3D_POINT_TABLE=public.file_point',
      'QP3D_EXPECTED_SRID=4490',
      'QP3D_OUTPUT_ROOT=data/file-tiles',
    ].join('\n'))

    expect(loadPipelineConfig({}, { cwd: join(root, 'packages', 'pipeline'), processEnv: {} })).toEqual({
      databaseUrl: 'postgres://file.example/qp3d',
      lineTable: 'public.file_line',
      pointTable: 'public.file_point',
      expectedSrid: 4490,
      outputRoot: resolve(root, 'data/file-tiles'),
    })
  })
})

async function createWorkspace(): Promise<string> {
  const root = join(tmpdir(), `qp3d-pipeline-config-${crypto.randomUUID()}`)
  await mkdir(join(root, 'packages', 'pipeline'), { recursive: true })
  await mkdir(join(root, 'config'), { recursive: true })
  await writeFile(join(root, 'pnpm-workspace.yaml'), 'packages:\n  - "packages/*"\n')
  return root
}
