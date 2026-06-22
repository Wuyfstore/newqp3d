import { describe, expect, it } from 'vitest'
import { createTileGrid } from '../src/tiles/tileGrid.js'

describe('createTileGrid', () => {
  it('splits bounds into deterministic child tiles', () => {
    const grid = createTileGrid(
      { minX: 0, minY: 0, maxX: 100, maxY: 100 },
      { maxFeaturesPerTile: 2, maxDepth: 2 },
    )

    expect(grid.root.bounds).toEqual({ minX: 0, minY: 0, maxX: 100, maxY: 100 })
    expect(grid.root.children).toHaveLength(4)
    expect(grid.root.children[0]?.bounds).toEqual({ minX: 0, minY: 0, maxX: 50, maxY: 50 })
  })

  it('keeps stable tile ids across full quadtree expansion', () => {
    const grid = createTileGrid(
      { minX: -10, minY: -10, maxX: 10, maxY: 10 },
      { maxFeaturesPerTile: 1, maxDepth: 2 },
    )

    expect(grid.root.id).toBe('root')
    expect(grid.root.children.map(child => child.id)).toEqual(['root-0', 'root-1', 'root-2', 'root-3'])
    expect(grid.root.children[0]?.children.map(child => child.id)).toEqual([
      'root-0-0',
      'root-0-1',
      'root-0-2',
      'root-0-3',
    ])
  })
})
