import { describe, expect, it } from 'vitest'
import { writeTileset } from '../src/tiles/tilesetWriter.js'

describe('writeTileset', () => {
  it('creates a Cesium-loadable tileset root with geometric error and content uri', () => {
    const tileset = writeTileset({
      assetVersion: '1.1',
      geometricError: 500,
      rootUri: 'tiles/root.glb',
      boundingVolume: { box: [0, 0, 0, 50, 0, 0, 0, 50, 0, 0, 0, 20] },
    })

    expect(tileset.asset.version).toBe('1.1')
    expect(tileset.root.geometricError).toBe(500)
    expect(tileset.root.content?.uri).toBe('tiles/root.glb')
    expect(tileset.root.refine).toBe('ADD')
  })

  it('preserves stable feature metadata in extras for API lookup', () => {
    const tileset = writeTileset({
      assetVersion: '1.1',
      geometricError: 500,
      rootUri: 'tiles/root.glb',
      boundingVolume: { box: [0, 0, 0, 50, 0, 0, 0, 50, 0, 0, 0, 20] },
      metadata: [
        {
          featureId: 7,
          businessId: 'sample-rain-1',
          properties: { gwlx: '雨水管' },
        },
      ],
    })

    expect(tileset.root.extras?.featureMetadata).toEqual([
      {
        featureId: 7,
        businessId: 'sample-rain-1',
        properties: { gwlx: '雨水管' },
      },
    ])
  })

  it('writes child tiles without forcing root content or root-level feature metadata', () => {
    const tileset = writeTileset({
      assetVersion: '1.1',
      geometricError: 500,
      boundingVolume: { box: [0, 0, 0, 100, 0, 0, 0, 100, 0, 0, 0, 20] },
      children: [
        {
          boundingVolume: { box: [-25, -25, 0, 25, 0, 0, 0, 25, 0, 0, 0, 10] },
          geometricError: 0,
          contentUri: 'tiles/root-0.glb',
          metadataUri: 'tiles/root-0.metadata.json',
        },
        {
          boundingVolume: { box: [25, -25, 0, 25, 0, 0, 0, 25, 0, 0, 0, 10] },
          geometricError: 0,
          contentUri: 'tiles/root-1.glb',
          metadataUri: 'tiles/root-1.metadata.json',
        },
      ],
    })

    expect(tileset.root.content).toBeUndefined()
    expect(tileset.root.extras?.featureMetadata).toBeUndefined()
    expect(tileset.root.children).toEqual([
      expect.objectContaining({
        geometricError: 0,
        content: { uri: 'tiles/root-0.glb' },
        extras: { metadataUri: 'tiles/root-0.metadata.json' },
      }),
      expect.objectContaining({
        geometricError: 0,
        content: { uri: 'tiles/root-1.glb' },
        extras: { metadataUri: 'tiles/root-1.metadata.json' },
      }),
    ])
  })
})
