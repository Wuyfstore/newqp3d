export interface Wgs84Position {
  longitude: number
  latitude: number
  height: number
}

export interface GeoReference {
  origin: Wgs84Position
  transform: number[]
  toLocal(position: Wgs84Position): [number, number, number]
}

const WGS84_SEMI_MAJOR_AXIS = 6378137
const WGS84_FIRST_ECCENTRICITY_SQUARED = 6.6943799901413165e-3
const WEB_MERCATOR_MAX_LATITUDE = 85.0511287798066
const DEGREE_TO_RADIAN = Math.PI / 180
const RADIAN_TO_DEGREE = 180 / Math.PI

export function sourceCoordinateToWgs84(
  coordinate: [number, number, number],
  srid: number | undefined,
): Wgs84Position {
  if (srid === 3857) {
    const longitude = (coordinate[0] / WGS84_SEMI_MAJOR_AXIS) * RADIAN_TO_DEGREE
    const latitude = (2 * Math.atan(Math.exp(coordinate[1] / WGS84_SEMI_MAJOR_AXIS)) - Math.PI / 2) * RADIAN_TO_DEGREE
    return {
      longitude,
      latitude: clamp(latitude, -WEB_MERCATOR_MAX_LATITUDE, WEB_MERCATOR_MAX_LATITUDE),
      height: coordinate[2],
    }
  }

  return {
    longitude: coordinate[0],
    latitude: coordinate[1],
    height: coordinate[2],
  }
}

export function createGeoReference(origin: Wgs84Position): GeoReference {
  const originEcef = wgs84ToEcef(origin)
  const basis = eastNorthUpBasis(origin.longitude, origin.latitude)

  return {
    origin,
    transform: [
      basis.east[0], basis.east[1], basis.east[2], 0,
      basis.north[0], basis.north[1], basis.north[2], 0,
      basis.up[0], basis.up[1], basis.up[2], 0,
      originEcef[0], originEcef[1], originEcef[2], 1,
    ],
    toLocal(position) {
      const ecef = wgs84ToEcef(position)
      const delta: [number, number, number] = [
        ecef[0] - originEcef[0],
        ecef[1] - originEcef[1],
        ecef[2] - originEcef[2],
      ]

      return [
        dot(delta, basis.east),
        dot(delta, basis.north),
        dot(delta, basis.up),
      ]
    },
  }
}

function wgs84ToEcef(position: Wgs84Position): [number, number, number] {
  const longitude = position.longitude * DEGREE_TO_RADIAN
  const latitude = position.latitude * DEGREE_TO_RADIAN
  const cosLatitude = Math.cos(latitude)
  const sinLatitude = Math.sin(latitude)
  const normal = WGS84_SEMI_MAJOR_AXIS / Math.sqrt(1 - WGS84_FIRST_ECCENTRICITY_SQUARED * sinLatitude * sinLatitude)

  return [
    (normal + position.height) * cosLatitude * Math.cos(longitude),
    (normal + position.height) * cosLatitude * Math.sin(longitude),
    (normal * (1 - WGS84_FIRST_ECCENTRICITY_SQUARED) + position.height) * sinLatitude,
  ]
}

function eastNorthUpBasis(longitudeDegrees: number, latitudeDegrees: number): {
  east: [number, number, number]
  north: [number, number, number]
  up: [number, number, number]
} {
  const longitude = longitudeDegrees * DEGREE_TO_RADIAN
  const latitude = latitudeDegrees * DEGREE_TO_RADIAN
  const cosLongitude = Math.cos(longitude)
  const sinLongitude = Math.sin(longitude)
  const cosLatitude = Math.cos(latitude)
  const sinLatitude = Math.sin(latitude)

  return {
    east: [-sinLongitude, cosLongitude, 0],
    north: [-sinLatitude * cosLongitude, -sinLatitude * sinLongitude, cosLatitude],
    up: [cosLatitude * cosLongitude, cosLatitude * sinLongitude, sinLatitude],
  }
}

function dot(left: [number, number, number], right: [number, number, number]): number {
  return left[0] * right[0] + left[1] * right[1] + left[2] * right[2]
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}
