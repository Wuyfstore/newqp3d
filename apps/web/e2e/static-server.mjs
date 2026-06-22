import { createReadStream } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { extname, isAbsolute, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(fileURLToPath(new URL('../../../', import.meta.url)))
const distRoot = resolve(repoRoot, 'apps/web/dist')
const tileRoot = resolve(repoRoot, 'data/tiles')
const port = Number(process.env.PORT ?? 5173)

const mimeTypes = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.glb', 'model/gltf-binary'],
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.wasm', 'application/wasm'],
])

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? '/', `http://${request.headers.host ?? '127.0.0.1'}`)

    if (url.pathname === '/api/versions/latest') {
      await sendFile(response, resolve(tileRoot, 'latest.json'))
      return
    }

    if (url.pathname === '/api/quality/latest') {
      const latest = JSON.parse(await readFile(resolve(tileRoot, 'latest.json'), 'utf8'))
      await sendFile(response, resolve(tileRoot, tilePath(latest.qualityReportUrl)))
      return
    }

    if (url.pathname.startsWith('/tiles/')) {
      await sendFile(response, resolve(tileRoot, tilePath(url.pathname)))
      return
    }

    const filePath = url.pathname === '/'
      ? resolve(distRoot, 'index.html')
      : resolve(distRoot, trimLeadingSlash(url.pathname))
    await sendFile(response, ensureInside(filePath, distRoot))
  } catch (error) {
    response.statusCode = 404
    response.end(error instanceof Error ? error.message : 'Not found')
  }
})

server.listen(port, '127.0.0.1', () => {
  console.log(`Pipe network acceptance server listening on http://127.0.0.1:${port}`)
})

function trimLeadingSlash(value) {
  return String(value).replace(/^\/+/, '')
}

function tilePath(value) {
  return trimLeadingSlash(value).replace(/^tiles\//, '')
}

function ensureInside(filePath, root) {
  const resolved = resolve(filePath)
  const relativePath = relative(resolve(root), resolved)
  if (relativePath.startsWith('..') || isAbsolute(relativePath)) {
    throw new Error('Path escapes static root')
  }
  return resolved
}

function sendFile(response, filePath) {
  return new Promise((resolvePromise, reject) => {
    const safePath = filePath.startsWith(tileRoot) ? ensureInside(filePath, tileRoot) : ensureInside(filePath, distRoot)
    response.setHeader('Content-Type', mimeTypes.get(extname(safePath)) ?? 'application/octet-stream')
    const stream = createReadStream(safePath)
    stream.on('error', reject)
    stream.on('end', resolvePromise)
    stream.pipe(response)
  })
}
