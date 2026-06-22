export type ParsedWkbGeometry =
  | { type: 'Point'; coordinates: [number, number]; srid?: number }
  | { type: 'LineString'; coordinates: Array<[number, number]>; srid?: number }

const EWKB_Z_FLAG = 0x80000000
const EWKB_SRID_FLAG = 0x20000000
const WKB_POINT = 1
const WKB_LINESTRING = 2

export function parseWkbGeometry(hex: string): ParsedWkbGeometry {
  const bytes = Buffer.from(hex, 'hex')
  if (bytes.byteLength < 5)
    throw new Error('WKB geometry is too short')

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const littleEndian = readByte(view, 0) === 1
  let offset = 1
  const rawType = readUint32(view, offset, littleEndian)
  offset += 4

  const hasZ = (rawType & EWKB_Z_FLAG) !== 0
  const hasSrid = (rawType & EWKB_SRID_FLAG) !== 0
  const geometryType = rawType & 0xFF
  let srid: number | undefined

  if (hasSrid) {
    srid = readUint32(view, offset, littleEndian)
    offset += 4
  }

  if (geometryType === WKB_POINT) {
    const point = readCoordinate(view, offset, littleEndian, hasZ)
    return srid === undefined
      ? { type: 'Point', coordinates: [point[0], point[1]] }
      : { type: 'Point', coordinates: [point[0], point[1]], srid }
  }

  if (geometryType === WKB_LINESTRING) {
    const count = readUint32(view, offset, littleEndian)
    offset += 4
    const coordinates: Array<[number, number]> = []

    for (let index = 0; index < count; index += 1) {
      const coordinate = readCoordinate(view, offset, littleEndian, hasZ)
      coordinates.push([coordinate[0], coordinate[1]])
      offset += hasZ ? 24 : 16
    }

    return srid === undefined
      ? { type: 'LineString', coordinates }
      : { type: 'LineString', coordinates, srid }
  }

  throw new Error(`Unsupported WKB geometry type: ${geometryType}`)
}

function readCoordinate(
  view: DataView,
  offset: number,
  littleEndian: boolean,
  hasZ: boolean,
): [number, number] {
  const x = readFloat64(view, offset, littleEndian)
  const y = readFloat64(view, offset + 8, littleEndian)
  if (hasZ)
    readFloat64(view, offset + 16, littleEndian)
  return [x, y]
}

function readByte(view: DataView, offset: number): number {
  ensureAvailable(view, offset, 1)
  return view.getUint8(offset)
}

function readUint32(view: DataView, offset: number, littleEndian: boolean): number {
  ensureAvailable(view, offset, 4)
  return view.getUint32(offset, littleEndian)
}

function readFloat64(view: DataView, offset: number, littleEndian: boolean): number {
  ensureAvailable(view, offset, 8)
  return view.getFloat64(offset, littleEndian)
}

function ensureAvailable(view: DataView, offset: number, byteLength: number): void {
  if (offset + byteLength > view.byteLength)
    throw new Error('WKB geometry ended unexpectedly')
}
