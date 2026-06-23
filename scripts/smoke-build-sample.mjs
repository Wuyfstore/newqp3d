import { spawn } from 'node:child_process'

await run(process.execPath, ['node_modules/typescript/bin/tsc', '-p', 'packages/runtime-config/tsconfig.build.json'])
await run(process.execPath, ['node_modules/typescript/bin/tsc', '-p', 'packages/shared/tsconfig.build.json'])
await run(process.execPath, ['node_modules/typescript/bin/tsc', '-p', 'packages/pipeline/tsconfig.json'])
await run(process.execPath, ['packages/pipeline/dist/cli.js', 'build', '--source', 'sample', '--output', 'data/tiles'])
await run(process.execPath, ['node_modules/typescript/bin/tsc', '-p', 'apps/api/tsconfig.json'])
await run(process.execPath, ['node_modules/vite/bin/vite.js', 'build'], { cwd: 'apps/web' })

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(...spawnArgs(command, args), {
      stdio: 'inherit',
      ...options,
    })

    child.on('error', reject)
    child.on('exit', (code) => {
      if (code === 0) {
        resolve()
      } else {
        reject(new Error(`${command} ${args.join(' ')} exited with code ${code}`))
      }
    })
  })
}

function spawnArgs(command, args) {
  return [command, args]
}
