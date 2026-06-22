export interface BoundingVolumeBox {
  box: [number, number, number, number, number, number, number, number, number, number, number, number]
}

export interface FeatureMetadata {
  featureId: number
  businessId: string
  properties: Record<string, unknown>
}

export interface TilesetInput {
  assetVersion?: string
  geometricError: number
  rootUri: string
  boundingVolume: BoundingVolumeBox
  metadata?: FeatureMetadata[]
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
  content?: {
    uri: string
  }
  extras?: {
    featureMetadata: FeatureMetadata[]
  }
}

export function writeTileset(input: TilesetInput): TilesetJson {
  return {
    asset: {
      version: input.assetVersion ?? '1.1',
    },
    geometricError: input.geometricError,
    root: {
      boundingVolume: input.boundingVolume,
      geometricError: input.geometricError,
      refine: 'ADD',
      content: {
        uri: input.rootUri,
      },
      ...(input.metadata && input.metadata.length > 0
        ? {
            extras: {
              featureMetadata: input.metadata,
            },
          }
        : {}),
    },
  }
}
