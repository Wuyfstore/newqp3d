import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

describe('root package scripts', () => {
  it('starts API and Web dev servers with one command', async () => {
    const packageJson = JSON.parse(
      await readFile(resolve(import.meta.dirname, '../../../package.json'), 'utf8'),
    ) as { scripts?: Record<string, string> }

    expect(packageJson.scripts?.dev).toBe(
      'pnpm --recursive --parallel --filter @new-qp3d/api --filter @new-qp3d/web run dev',
    )
  })

  it('keeps sample smoke output isolated from the active local tile root', async () => {
    const script = await readFile(
      resolve(import.meta.dirname, '../../../scripts/smoke-build-sample.mjs'),
      'utf8',
    )

    expect(script).not.toContain("'--output', 'data/tiles'")
    expect(script).not.toContain('"--output", "data/tiles"')
    expect(script).toContain('data/smoke-tiles')
  })
})
