import type { HeightQuality, PipeSpec } from '@new-qp3d/shared'

export interface HeightInput {
  spec: PipeSpec
  qdndbg: number | null
  zdndbg: number | null
  qdms: number | null
  zdms: number | null
  groundElevation: number
  defaultDepthMeters: number
}

export interface HeightResult {
  startCenterZ: number
  endCenterZ: number
  quality: HeightQuality
}

function halfHeightMeters(spec: PipeSpec): number {
  return spec.kind === 'round' ? spec.diameterMm / 2000 : spec.heightMm / 2000
}

function roundMillimeter(value: number): number {
  return Math.round(value * 1000) / 1000
}

export function computePipeCenterHeights(input: HeightInput): HeightResult {
  const offset = halfHeightMeters(input.spec)

  if (input.qdndbg != null && input.zdndbg != null) {
    return {
      startCenterZ: roundMillimeter(input.qdndbg + offset),
      endCenterZ: roundMillimeter(input.zdndbg + offset),
      quality: 'inner-bottom',
    }
  }

  if (input.qdms != null && input.zdms != null) {
    return {
      startCenterZ: roundMillimeter(input.groundElevation - input.qdms + offset),
      endCenterZ: roundMillimeter(input.groundElevation - input.zdms + offset),
      quality: 'depth-estimated',
    }
  }

  const center = roundMillimeter(input.groundElevation - input.defaultDepthMeters + offset)
  return { startCenterZ: center, endCenterZ: center, quality: 'defaulted' }
}
