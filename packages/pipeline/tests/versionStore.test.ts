import { randomUUID } from 'node:crypto'
import { mkdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { describe, expect, it } from 'vitest'

import { prepareVersion, publishVersion } from '../src/publish/versionStore.js'

describe('versionStore', () => {
  it('prepares a validated build version without switching latest', async () => {
    const outputRoot = await makeTempDir('qp3d-version-store-')

    const prepared = await prepareVersion({
      outputRoot,
      version: 'network-20260621-1500',
      templateId: 'template-1',
      templateVersion: '1.2.3',
      buildTaskId: 'build-1',
      files: {
        'tileset.json': JSON.stringify({ asset: { version: '1.1' } }),
        'root.glb': new Uint8Array([0x67, 0x6C, 0x54, 0x46]),
        'quality-report.json': JSON.stringify({ versionId: 'network-20260621-1500' }),
      },
    })

    expect(prepared.version).toBe('network-20260621-1500')
    await expect(pathExists(join(outputRoot, 'latest.json'))).resolves.toBe(false)
    expect(await readJson(join(outputRoot, 'network-20260621-1500', 'version-record.json'))).toEqual({
      version: 'network-20260621-1500',
      status: 'ready',
      templateId: 'template-1',
      templateVersion: '1.2.3',
      buildTaskId: 'build-1',
      tilesetUrl: '/tiles/network-20260621-1500/tileset.json',
      metadataUrl: '/tiles/network-20260621-1500/metadata.json',
      qualityReportUrl: '/tiles/network-20260621-1500/quality-report.json',
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
    })
    await expect(readFile(join(outputRoot, 'network-20260621-1500', 'tileset.json'), 'utf8'))
      .resolves
      .toContain('"asset"')
  })

  it('adds a flow tileset URL when flow files are published', async () => {
    const outputRoot = await makeTempDir('qp3d-version-store-')

    await prepareVersion({
      outputRoot,
      version: 'network-20260621-1500',
      files: {
        'tileset.json': JSON.stringify({ asset: { version: '1.1' } }),
        'root.glb': new Uint8Array([0x67, 0x6C, 0x54, 0x46]),
        'flow/tileset.json': JSON.stringify({ asset: { version: '1.1' } }),
        'flow/root.glb': new Uint8Array([0x67, 0x6C, 0x54, 0x46]),
        'quality-report.json': JSON.stringify({ versionId: 'network-20260621-1500' }),
      },
    })

    expect(await readJson(join(outputRoot, 'network-20260621-1500', 'version-record.json'))).toEqual(expect.objectContaining({
      flowTilesetUrl: '/tiles/network-20260621-1500/flow/tileset.json',
    }))
  })

  it('publishes and rolls back by switching only latest manifest', async () => {
    const outputRoot = await makeTempDir('qp3d-version-store-')

    await prepareMinimalVersion(outputRoot, 'network-old')
    await prepareMinimalVersion(outputRoot, 'network-new')

    await publishVersion({ outputRoot, version: 'network-old' })
    await publishVersion({ outputRoot, version: 'network-new' })

    expect(await readJson(join(outputRoot, 'latest.json'))).toEqual(expect.objectContaining({
      version: 'network-new',
      tilesetUrl: '/tiles/network-new/tileset.json',
    }))

    await publishVersion({ outputRoot, version: 'network-old' })

    expect(await readJson(join(outputRoot, 'latest.json'))).toEqual(expect.objectContaining({
      version: 'network-old',
      tilesetUrl: '/tiles/network-old/tileset.json',
    }))
    expect(await readJson(join(outputRoot, 'network-new', 'version-record.json'))).toEqual(expect.objectContaining({
      version: 'network-new',
      status: 'superseded',
    }))
  })

  it('does not replace latest when validation fails', async () => {
    const outputRoot = await makeTempDir('qp3d-version-store-')

    await prepareVersion({
      outputRoot,
      version: 'network-20260621-1500',
      files: {
        'tileset.json': '{}',
        'root.glb': new Uint8Array([1]),
        'quality-report.json': '{}',
      },
    })

    await publishVersion({ outputRoot, version: 'network-20260621-1500' })
    const previousLatest = await readFile(join(outputRoot, 'latest.json'), 'utf8')

    await expect(prepareVersion({
      outputRoot,
      version: 'network-20260621-1600',
      files: {
        'tileset.json': '{}',
        'root.glb': new Uint8Array([1]),
      },
    })).rejects.toThrow('Missing required publish file: quality-report.json')

    expect(await readFile(join(outputRoot, 'latest.json'), 'utf8')).toBe(previousLatest)
  })

  it('keeps the existing version directory when a same-version publish fails validation', async () => {
    const outputRoot = await makeTempDir('qp3d-version-store-')

    await prepareVersion({
      outputRoot,
      version: 'network-20260621-1500',
      files: {
        'tileset.json': JSON.stringify({ ok: true }),
        'root.glb': new Uint8Array([1]),
        'quality-report.json': JSON.stringify({ ok: true }),
      },
    })

    await expect(prepareVersion({
      outputRoot,
      version: 'network-20260621-1500',
      files: {
        'tileset.json': JSON.stringify({ ok: false }),
      },
    })).rejects.toThrow('Missing required publish file: root.glb')

    expect(await readFile(join(outputRoot, 'network-20260621-1500', 'quality-report.json'), 'utf8'))
      .toContain('"ok":true')
  })

  it('reports the validation failure when failed staging cleanup is also possible', async () => {
    const outputRoot = await makeTempDir('qp3d-version-store-')

    await expect(prepareVersion({
      outputRoot,
      version: 'network-20260621-1700',
      files: {
        'tileset.json': '{}',
      },
    })).rejects.toThrow('Missing required publish file: root.glb')
  })
})

async function prepareMinimalVersion(outputRoot: string, version: string): Promise<void> {
  await prepareVersion({
    outputRoot,
    version,
    files: {
      'tileset.json': JSON.stringify({ version }),
      'root.glb': new Uint8Array([1]),
      'quality-report.json': JSON.stringify({ versionId: version }),
    },
  })
}

async function makeTempDir(prefix: string): Promise<string> {
  const path = join(tmpdir(), `${prefix}${randomUUID()}`)
  await mkdir(path, { recursive: true })
  return path
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, 'utf8'))
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}
