export interface Bounds {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

export interface TileGridOptions {
  maxFeaturesPerTile: number
  maxDepth: number
}

export interface TileGridNode {
  id: string
  bounds: Bounds
  depth: number
  children: TileGridNode[]
}

export interface TileGrid {
  root: TileGridNode
  options: TileGridOptions
}

export function createTileGrid(bounds: Bounds, options: TileGridOptions): TileGrid {
  return {
    root: createNode('root', bounds, 0, options.maxDepth),
    options,
  }
}

function createNode(id: string, bounds: Bounds, depth: number, maxDepth: number): TileGridNode {
  return {
    id,
    bounds,
    depth,
    children: depth < maxDepth ? splitBounds(bounds).map((childBounds, index) => (
      createNode(`${id}-${index}`, childBounds, depth + 1, maxDepth)
    )) : [],
  }
}

function splitBounds(bounds: Bounds): Bounds[] {
  const midX = (bounds.minX + bounds.maxX) / 2
  const midY = (bounds.minY + bounds.maxY) / 2

  return [
    { minX: bounds.minX, minY: bounds.minY, maxX: midX, maxY: midY },
    { minX: midX, minY: bounds.minY, maxX: bounds.maxX, maxY: midY },
    { minX: bounds.minX, minY: midY, maxX: midX, maxY: bounds.maxY },
    { minX: midX, minY: midY, maxX: bounds.maxX, maxY: bounds.maxY },
  ]
}
