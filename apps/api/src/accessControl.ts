import type { FastifyReply, FastifyRequest, preHandlerHookHandler } from 'fastify'

export type AccessRole = 'viewer' | 'builder' | 'publisher' | 'admin'
export type AccessCapability =
  | 'versionReport'
  | 'networkQuery'
  | 'templateRead'
  | 'templateWrite'
  | 'taskRead'
  | 'taskWrite'
  | 'publish'
  | 'datasourceAdmin'

export interface AccessControlOptions {
  enabled?: boolean
  headerName?: string
}

export interface AccessControl {
  requireCapability(capability: AccessCapability): preHandlerHookHandler
}

const DEFAULT_ROLE_HEADER = 'x-qp3d-role'

const roleCapabilities: Record<AccessRole, ReadonlySet<AccessCapability>> = {
  viewer: new Set(['versionReport']),
  builder: new Set(['versionReport', 'networkQuery', 'templateRead', 'templateWrite', 'taskRead', 'taskWrite']),
  publisher: new Set(['versionReport', 'publish']),
  admin: new Set([
    'versionReport',
    'networkQuery',
    'templateRead',
    'templateWrite',
    'taskRead',
    'taskWrite',
    'publish',
    'datasourceAdmin',
  ]),
}

export function createAccessControl(options: AccessControlOptions = {}): AccessControl {
  const enabled = options.enabled === true
  const headerName = (options.headerName ?? DEFAULT_ROLE_HEADER).toLowerCase()

  return {
    requireCapability(capability) {
      return (request, reply, done) => {
        if (!enabled) {
          done()
          return
        }

        const roleResult = readRole(request, headerName)
        if (roleResult.kind === 'missing') {
          sendMissingRole(reply, headerName)
          return
        }
        if (roleResult.kind === 'unknown') {
          sendUnknownRole(reply, roleResult.role)
          return
        }

        const capabilities = roleCapabilities[roleResult.role]
        if (!capabilities.has(capability)) {
          sendInsufficientPermission(reply, roleResult.role, capability)
          return
        }

        done()
      }
    },
  }
}

type RoleReadResult =
  | { kind: 'ok'; role: AccessRole }
  | { kind: 'missing' }
  | { kind: 'unknown'; role: string }

function readRole(request: FastifyRequest, headerName: string): RoleReadResult {
  const raw = request.headers[headerName]
  const value = Array.isArray(raw) ? raw[0] : raw
  const role = typeof value === 'string' ? value.trim().toLowerCase() : ''

  if (!role) {
    return { kind: 'missing' }
  }

  if (isAccessRole(role)) {
    return { kind: 'ok', role }
  }

  return { kind: 'unknown', role }
}

function isAccessRole(role: string): role is AccessRole {
  return role === 'viewer' || role === 'builder' || role === 'publisher' || role === 'admin'
}

function sendMissingRole(reply: FastifyReply, headerName: string): void {
  reply.code(401).send({
    error: 'Missing role',
    header: headerName,
  })
}

function sendUnknownRole(reply: FastifyReply, role: string): void {
  reply.code(403).send({
    error: 'Unknown role',
    role,
  })
}

function sendInsufficientPermission(
  reply: FastifyReply,
  role: AccessRole,
  requiredCapability: AccessCapability,
): void {
  reply.code(403).send({
    error: 'Insufficient permissions',
    role,
    requiredCapability,
  })
}
