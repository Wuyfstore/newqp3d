import { mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { readEnv } from '../src/config/env.js'

describe('readEnv', () => {
  it('accepts QP3D_DATABASE_URL for consistency with pipeline configuration', () => {
    const cwd = createIsolatedCwd()
    expect(readEnv({
      QP3D_DATABASE_URL: 'postgres://example.invalid/qp3d',
    }, { cwd, processEnv: {} }).databaseUrl).toBe('postgres://example.invalid/qp3d')
  })

  it('uses the PRD source tables by default', () => {
    const cwd = createIsolatedCwd()
    expect(readEnv({
      QP3D_DATABASE_URL: 'postgres://example.invalid/qp3d',
    }, { cwd, processEnv: {} })).toMatchObject({
      lineTable: 'public.sys_016_tancexbtjinfo_sde',
      pointTable: 'public.sys_016_tancedbtjinfo_sde',
    })
  })

  it('loads backend configuration from config/backend.env when no command-line env is provided', async () => {
    const root = await createWorkspace()
    await writeFile(join(root, 'config', 'backend.env'), [
      'QP3D_DATABASE_URL=postgres://file.example/qp3d',
      'QP3D_LINE_TABLE=public.file_line',
      'QP3D_POINT_TABLE=public.file_point',
      'QP3D_OUTPUT_ROOT=data/file-tiles',
      'HOST=127.0.0.1',
      'PORT=4201',
    ].join('\n'))

    expect(readEnv({}, { cwd: join(root, 'apps', 'api'), processEnv: {} })).toEqual({
      databaseUrl: 'postgres://file.example/qp3d',
      lineTable: 'public.file_line',
      pointTable: 'public.file_point',
      outputRoot: resolve(root, 'data/file-tiles'),
      host: '127.0.0.1',
      port: 4201,
    })
  })
})

async function createWorkspace(): Promise<string> {
  const root = join(tmpdir(), `qp3d-api-env-${crypto.randomUUID()}`)
  await mkdir(join(root, 'apps', 'api'), { recursive: true })
  await mkdir(join(root, 'config'), { recursive: true })
  await writeFile(join(root, 'pnpm-workspace.yaml'), 'packages:\n  - "apps/*"\n')
  return root
}

function createIsolatedCwd(): string {
  return join(tmpdir(), `qp3d-api-env-empty-${crypto.randomUUID()}`)
}
