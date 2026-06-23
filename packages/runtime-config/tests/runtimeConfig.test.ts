import { mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { loadRuntimeConfig, parseRuntimeConfig, QP3D_WORKSPACE_ROOT } from '../src/index.js'

describe('parseRuntimeConfig', () => {
  it('parses comments, blank lines, and quoted values from env-style files', () => {
    expect(parseRuntimeConfig(`
# local backend configuration
QP3D_DATABASE_URL="postgres://user:pass@example.invalid:15432/qcwebserver"
QP3D_LINE_TABLE=public.custom_line

PORT='4200'
`)).toEqual({
      QP3D_DATABASE_URL: 'postgres://user:pass@example.invalid:15432/qcwebserver',
      QP3D_LINE_TABLE: 'public.custom_line',
      PORT: '4200',
    })
  })
})

describe('loadRuntimeConfig', () => {
  it('loads config/backend.env from the workspace root discovered above the current directory', async () => {
    const root = await createWorkspace()
    await writeFile(join(root, 'apps', 'api', 'package.json'), '{"name":"@new-qp3d/api"}\n')
    await writeFile(join(root, 'config', 'backend.env'), [
      'QP3D_DATABASE_URL=postgres://file.example/qp3d',
      'QP3D_OUTPUT_ROOT=data/from-file',
    ].join('\n'))

    expect(loadRuntimeConfig({ cwd: join(root, 'apps', 'api'), env: {} })).toMatchObject({
      [QP3D_WORKSPACE_ROOT]: root,
      QP3D_DATABASE_URL: 'postgres://file.example/qp3d',
      QP3D_OUTPUT_ROOT: 'data/from-file',
    })
  })

  it('lets process environment values override config file values', async () => {
    const root = await createWorkspace()
    await writeFile(join(root, 'config', 'backend.env'), 'QP3D_OUTPUT_ROOT=data/from-file\n')

    expect(loadRuntimeConfig({
      cwd: root,
      env: { QP3D_OUTPUT_ROOT: 'data/from-env' },
    }).QP3D_OUTPUT_ROOT).toBe('data/from-env')
  })

  it('lets explicit overrides win over both environment and config file values', async () => {
    const root = await createWorkspace()
    await writeFile(join(root, 'config', 'backend.env'), 'PORT=4100\n')

    expect(loadRuntimeConfig({
      cwd: root,
      env: { PORT: '4200' },
      overrides: { PORT: '4300' },
    }).PORT).toBe('4300')
  })
})

async function createWorkspace(): Promise<string> {
  const root = join(tmpdir(), `qp3d-runtime-config-${crypto.randomUUID()}`)
  await mkdir(join(root, 'apps', 'api'), { recursive: true })
  await mkdir(join(root, 'config'), { recursive: true })
  await writeFile(join(root, 'pnpm-workspace.yaml'), 'packages:\n  - "apps/*"\n')
  return root
}
