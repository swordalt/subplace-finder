import { spawnSync } from 'node:child_process'
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const distRoot = resolve(root, 'dist')
const isWindows = process.platform === 'win32'

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? root,
    encoding: 'utf8',
    shell: false,
    stdio: options.capture ? 'pipe' : 'inherit',
  })

  if (result.status !== 0) {
    const detail = options.capture ? result.stderr || result.stdout : ''
    throw new Error(`Command failed: ${command} ${args.join(' ')}${detail ? `\n${detail}` : ''}`)
  }

  return options.capture ? result.stdout.trim() : ''
}

function npm(args) {
  if (!isWindows) {
    run('npm', args)
    return
  }

  run('cmd.exe', ['/d', '/s', '/c', `npm ${args.join(' ')}`])
}

function getRepoName(remoteUrl) {
  const normalized = remoteUrl.replace(/\.git$/, '').replace(/\\/g, '/')
  const remoteName = basename(normalized)

  return remoteName || 'subplace-finder'
}

function copyDistToDeployRoot(deployRoot) {
  rmSync(deployRoot, { recursive: true, force: true })
  mkdirSync(deployRoot, { recursive: true })

  for (const entry of readdirSync(distRoot)) {
    cpSync(join(distRoot, entry), join(deployRoot, entry), { recursive: true })
  }

  const indexPath = join(deployRoot, 'index.html')

  if (existsSync(indexPath)) {
    cpSync(indexPath, join(deployRoot, '404.html'))
  }

  writeFileSync(join(deployRoot, '.nojekyll'), '')
}

const remoteUrl = run('git', ['config', '--get', 'remote.origin.url'], { capture: true })
const repoName = getRepoName(remoteUrl)
const basePath = process.env.GITHUB_PAGES_BASE ?? `/${repoName}/`
const branch = process.env.GITHUB_PAGES_BRANCH ?? 'gh-pages'
const deployMessage =
  process.env.GITHUB_PAGES_MESSAGE ?? `Deploy ${new Date().toISOString()}`

console.log(`Building with GitHub Pages base path: ${basePath}`)
npm(['run', 'build', '--', `--base=${basePath}`])

if (!existsSync(distRoot)) {
  throw new Error('Build completed, but dist was not created.')
}

const tempRoot = await mkdtemp(join(tmpdir(), 'subplace-finder-pages-'))
const deployRoot = join(tempRoot, 'site')

try {
  copyDistToDeployRoot(deployRoot)

  run('git', ['init'], { cwd: deployRoot })
  run('git', ['checkout', '-B', branch], { cwd: deployRoot })
  run('git', ['remote', 'add', 'origin', remoteUrl], { cwd: deployRoot })
  run('git', ['add', '.'], { cwd: deployRoot })
  run('git', ['commit', '-m', deployMessage], { cwd: deployRoot })
  run('git', ['push', '--force', 'origin', branch], { cwd: deployRoot })

  console.log(`Deployed dist to ${branch}.`)
} finally {
  rmSync(tempRoot, { recursive: true, force: true })
}
