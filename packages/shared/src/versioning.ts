import type { BuildVersion } from './domain.js'

export function createBuildVersion(date: Date): BuildVersion {
  const pad = (value: number) => String(value).padStart(2, '0')
  const id = [
    date.getUTCFullYear(),
    pad(date.getUTCMonth() + 1),
    pad(date.getUTCDate()),
    '-',
    pad(date.getUTCHours()),
    pad(date.getUTCMinutes()),
  ].join('')

  return {
    id: `network-${id}`,
    createdAt: date.toISOString(),
  }
}
