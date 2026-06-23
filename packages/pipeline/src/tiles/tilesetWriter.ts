export interface BoundingVolumeBox {
  box: [number, number, number, number, number, number, number, number, number, number, number, number]
}

export interface FeatureMetadata {
  featureId: number
  businessId: string
  properties: Record<string, unknown>
}

export interface TilesetChildInput {
  boundingVolume: BoundingVolumeBox
  geometricError: number
  contentUri: string
  metadataUri?: string
  children?: TilesetChildInput[]
}

export interface TilesetInput {
  assetVersion?: string
  geometricError: number
  rootUri?: string
  boundingVolume: BoundingVolumeBox
  transform?: number[]
  metadata?: FeatureMetadata[]
  children?: TilesetChildInput[]
}

export interface TilesetJson {
  asset: {
    version: string
  }
  geometricError: number
  root: TilesetTileJson
}

export interface TilesetTileJson {
  boundingVolume: BoundingVolumeBox
  geometricError: number
  refine: 'ADD'
  transform?: number[]
  content?: {
    uri: string
  }
  extras?: {
    featureMetadata?: FeatureMetadata[]
    metadataUri?: string
  }
  children?: TilesetTileJson[]
}

export function writeTileset(input: TilesetInput): TilesetJson {
  const root: TilesetTileJson = {
    boundingVolume: input.boundingVolume,
    geometricError: input.geometricError,
    refine: 'ADD',
    ...(input.transform ? { transform: input.transform } : {}),
    ...(input.rootUri ? { content: { uri: input.rootUri } } : {}),
    ...(input.metadata && input.metadata.length > 0
      ? {
          extras: {
            featureMetadata: input.metadata,
          },
        }
      : {}),
    ...(input.children && input.children.length > 0
      ? { children: input.children.map(child => childTileToJson(child)) }
      : {}),
  }

  return {
    asset: {
      version: input.assetVersion ?? '1.1',
    },
    geometricError: input.geometricError,
    root,
  }
}

function childTileToJson(input: TilesetChildInput): TilesetTileJson {
  return {
    boundingVolume: input.boundingVolume,
    geometricError: input.geometricError,
    refine: 'ADD',
    content: {
      uri: input.contentUri,
    },
    ...(input.metadataUri ? { extras: { metadataUri: input.metadataUri } } : {}),
    ...(input.children && input.children.length > 0
      ? { children: input.children.map(child => childTileToJson(child)) }
      : {}),
  }
}
