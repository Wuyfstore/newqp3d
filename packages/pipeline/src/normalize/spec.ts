import type { PipeSpec } from '@new-qp3d/shared'

const DEFAULT_DIAMETER_MM = 300

export function parsePipeSpec(raw: string | null | undefined, defaultDiameterMm = DEFAULT_DIAMETER_MM): PipeSpec {
  const source = raw ?? ''
  const value = source.trim().toUpperCase().replace(/×/g, 'X').replace(/^DN/, '')

  const box = value.match(/^(\d+(?:\.\d+)?)\s*X\s*(\d+(?:\.\d+)?)$/)
  if (box) {
    const widthMm = Number(box[1])
    const heightMm = Number(box[2])
    if (widthMm > 0 && heightMm > 0) {
      return { kind: 'box', widthMm, heightMm, source, quality: 'parsed' }
    }
  }

  const round = value.match(/^(\d+(?:\.\d+)?)$/)
  if (round) {
    const diameterMm = Number(round[1])
    if (diameterMm > 0) {
      return { kind: 'round', diameterMm, source, quality: 'parsed' }
    }
  }

  return { kind: 'round', diameterMm: defaultDiameterMm, source, quality: 'defaulted' }
}
