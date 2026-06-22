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
})
