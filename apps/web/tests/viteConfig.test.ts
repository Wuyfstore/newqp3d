// @vitest-environment node

import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { readBackendDevSettings } from '../vite.config'

describe('web vite config', () => {
  it('reads the dev API target and tile root from backend config', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'qp3d-web-config-'))
    const configPath = join(workspaceRoot, 'backend.env')
    await writeFile(configPath, [
      'HOST=0.0.0.0',
      'PORT=4123',
      'QP3D_OUTPUT_ROOT=published/tiles',
    ].join('\n'))

    const settings = readBackendDevSettings({
      env: { QP3D_CONFIG_FILE: configPath },
      workspaceRoot,
    })

    expect(settings.apiOrigin).toBe('http://127.0.0.1:4123')
    expect(settings.tileRoot).toBe(resolve(workspaceRoot, 'published/tiles'))
  })
})
