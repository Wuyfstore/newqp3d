export type PipeLayerType = '雨水管' | '污水管' | string
export type PipeOwnerScope = '市政' | '小区' | '农村' | string

export interface PipeLineRawRow {
  guid: string
  qdbm: string | null
  zdbm: string | null
  cz: string | null
  dmcc: number | null
  gg: string | null
  qdms: number | null
  zdms: number | null
  qdndbg: number | null
  zdndbg: number | null
  gwlx: PipeLayerType | null
  gs: PipeOwnerScope | null
  msfs: string | null
  lx: string | null
  gdsx: string | null
  gdcd: string | null
  geomWkbHex: string
}

export interface PointFacilityRawRow {
  gdbm: string | null
  hzb: number | null
  zzb: number | null
  lbmc: string | null
  dmbg: number | null
  kj: number | null
  js: number | null
  ms: number | null
  gg: string | null
  jgcz: string | null
  jgxz: string | null
  jgcc: string | null
  tag: string | null
  geomWkbHex: string
}

export type PipeSpec =
  | { kind: 'round'; diameterMm: number; source: string; quality: 'parsed' | 'defaulted' }
  | { kind: 'box'; widthMm: number; heightMm: number; source: string; quality: 'parsed' | 'defaulted' }

export type HeightQuality = 'inner-bottom' | 'depth-estimated' | 'defaulted'

export interface BuildVersion {
  id: string
  createdAt: string
}
