import * as p from '@clack/prompts'
import { spawn } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import process from 'node:process'

const root = resolve(import.meta.dirname, '..')
const repo = 'Tenkayro/StreamDash'
const versionFiles = ['package.json', 'package-lock.json', 'src-tauri/Cargo.toml', 'src-tauri/Cargo.lock', 'src-tauri/tauri.conf.json']

function executable(name) {
  return process.platform === 'win32' && ['npm', 'npx'].includes(name) ? `${name}.cmd` : name
}

function quoteArgument(value) {
  return /^[\w\-.\\/:@=,+]+$/.test(value) ? value : `"${value.replace(/"/g, '""')}"`
}

function spawnProcess(name, args, options) {
  const command = executable(name)
  // Node no longer spawns .cmd/.bat files without a shell (CVE-2024-27980), so run
  // command scripts through cmd.exe and hand the arguments over verbatim.
  if (process.platform === 'win32' && /\.(cmd|bat)$/i.test(command)) {
    const line = [command, ...args].map(quoteArgument).join(' ')
    return spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `"${line}"`], {
      ...options,
      windowsVerbatimArguments: true,
    })
  }
  return spawn(command, args, options)
}

async function run(name, args, options = {}) {
  return new Promise((resolveRun, reject) => {
    const child = spawnProcess(name, args, {
      cwd: root,
      env: options.env || process.env,
      windowsHide: true,
      shell: false,
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.on('error', (error) => reject(new Error(`${name} could not be started: ${error.message}`)))
    child.on('close', (code) => {
      if (code === 0 || options.allowFailure) return resolveRun({ code, stdout: stdout.trim(), stderr: stderr.trim() })
      const output = `${stdout}\n${stderr}`.trim()
      reject(new Error(`${name} ${args.join(' ')} failed${output ? `:\n${output.slice(-5000)}` : ''}`))
    })
  })
}

function parseVersion(value) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(value ?? '')
  return match?.slice(1).map(Number)
}

function bumpVersion(current, kind) {
  const [major, minor, patch] = parseVersion(current)
  if (kind === 'major') return `${major + 1}.0.0`
  if (kind === 'minor') return `${major}.${minor + 1}.0`
  return `${major}.${minor}.${patch + 1}`
}

function cancelled(value) {
  if (!p.isCancel(value)) return false
  p.cancel('Release cancelled. No files were changed.')
  process.exit(0)
}

async function updateVersions(version) {
  const packageJson = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
  packageJson.version = version
  await writeFile(join(root, 'package.json'), `${JSON.stringify(packageJson, null, 2)}\n`)

  const packageLock = JSON.parse(await readFile(join(root, 'package-lock.json'), 'utf8'))
  packageLock.version = version
  if (packageLock.packages?.['']) packageLock.packages[''].version = version
  await writeFile(join(root, 'package-lock.json'), `${JSON.stringify(packageLock, null, 2)}\n`)

  const cargoPath = join(root, 'src-tauri/Cargo.toml')
  const cargo = await readFile(cargoPath, 'utf8')
  await writeFile(cargoPath, cargo.replace(/^(version\s*=\s*")[^"]+("\s*)$/m, `$1${version}$2`))

  const tauriPath = join(root, 'src-tauri/tauri.conf.json')
  const tauri = JSON.parse(await readFile(tauriPath, 'utf8'))
  tauri.version = version
  await writeFile(tauriPath, `${JSON.stringify(tauri, null, 2)}\n`)
}

async function main() {
  p.intro('StreamDash Release')
  if (process.platform !== 'win32') throw new Error('The StreamDash MSI release must be built on Windows.')

  const check = p.spinner()
  check.start('Checking Git, GitHub, and updater signing configuration')
  let keyPath
  let pendingChanges = ''
  try {
    const status = await run('git', ['status', '--porcelain'])
    pendingChanges = status.stdout
    await run('gh', ['auth', 'status'])
    const remote = await run('git', ['remote', 'get-url', 'origin'])
    if (!remote.stdout.toLowerCase().includes('tenkayro/streamdash')) throw new Error(`origin does not point to ${repo}.`)
    const branch = await run('git', ['branch', '--show-current'])
    if (branch.stdout !== 'main') throw new Error('Releases must be created from the main branch.')

    keyPath = process.env.TAURI_SIGNING_PRIVATE_KEY || join(homedir(), '.tauri', 'streamdash-updater.key')
    const publicKeyPath = `${keyPath}.pub`
    const publicKey = (await readFile(publicKeyPath, 'utf8')).trim()
    const tauriConfig = JSON.parse(await readFile(join(root, 'src-tauri/tauri.conf.json'), 'utf8'))
    if (tauriConfig.plugins?.updater?.pubkey !== publicKey) throw new Error('The configured updater public key does not match the local signing key.')
    check.stop('Release environment is ready')
  } catch (error) {
    check.stop('Release environment check failed')
    throw error
  }

  const currentVersion = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')).version
  const bump = await p.select({
    message: `Current version is ${currentVersion}. Choose the next version:`,
    options: [
      { value: 'patch', label: `Patch  → ${bumpVersion(currentVersion, 'patch')}` },
      { value: 'minor', label: `Minor  → ${bumpVersion(currentVersion, 'minor')}` },
      { value: 'major', label: `Major  → ${bumpVersion(currentVersion, 'major')}` },
      { value: 'custom', label: 'Enter a custom version' },
    ],
  })
  cancelled(bump)

  let version = bump === 'custom' ? await p.text({
    message: 'Version',
    placeholder: currentVersion,
    validate: (value) => parseVersion(value) ? undefined : 'Use semantic versioning, for example 1.2.3.',
  }) : bumpVersion(currentVersion, bump)
  cancelled(version)
  version = (version ?? '').trim()

  const summary = await p.text({
    message: 'Short release summary shown inside StreamDash',
    placeholder: `StreamDash ${version} improvements and fixes.`,
    defaultValue: `StreamDash ${version} improvements and fixes.`,
    validate: (value) => (value ?? '').trim() ? undefined : 'Enter a short release summary.',
  })
  cancelled(summary)

  let changesCommitMessage = ''
  if (pendingChanges) {
    p.note(pendingChanges, 'Changes that will be included')
    const includeChanges = await p.confirm({ message: 'Commit these pending changes before creating the version commit?', initialValue: true })
    cancelled(includeChanges)
    if (!includeChanges) { p.cancel('Release cancelled. Commit or stash the changes you do not want to publish.'); return }
    changesCommitMessage = await p.text({
      message: 'Commit message for the pending changes',
      defaultValue: 'feat: prepare StreamDash release',
      validate: (value) => (value ?? '').trim() ? undefined : 'Enter a commit message.',
    })
    cancelled(changesCommitMessage)
  }

  const tag = `v${version}`
  const existingTag = await run('git', ['rev-parse', '-q', '--verify', `refs/tags/${tag}`], { allowFailure: true })
  if (existingTag.code === 0) throw new Error(`Tag ${tag} already exists.`)
  const existingRelease = await run('gh', ['release', 'view', tag, '--repo', repo], { allowFailure: true })
  if (existingRelease.code === 0) throw new Error(`GitHub release ${tag} already exists.`)

  p.note([
    `${currentVersion}  →  ${version}`,
    `Repository: ${repo}`,
    'Artifacts: MSI installer, signed updater archive, signature, latest.json',
    'GitHub release notes: generated automatically',
  ].join('\n'), 'Release summary')
  const confirmed = await p.confirm({ message: `Build, commit${pendingChanges ? ' pending changes' : ''}, tag, push, and publish ${tag}?`, initialValue: true })
  cancelled(confirmed)
  if (!confirmed) { p.cancel('Release cancelled. No files were changed.'); return }

  if (pendingChanges) {
    const save = p.spinner()
    save.start('Committing the approved pending changes')
    await run('git', ['add', '--all'])
    await run('git', ['commit', '-m', (changesCommitMessage ?? '').trim()])
    save.stop('Pending changes committed')
  }

  const snapshots = new Map(await Promise.all(versionFiles.map(async (file) => [file, await readFile(join(root, file), 'utf8')])))
  let committed = false
  try {
    const progress = p.spinner()
    progress.start(`Updating project versions to ${version}`)
    await updateVersions(version)
    progress.message('Running TypeScript and Rust checks')
    await run('npm', ['run', 'check'])
    await run('cargo', ['check', '--manifest-path', 'src-tauri/Cargo.toml'])

    progress.message('Building and signing the MSI update artifacts')
    const env = { ...process.env, TAURI_SIGNING_PRIVATE_KEY: keyPath }
    await run('npm', ['run', 'setup'], { env })

    const bundleDirectory = join(root, 'src-tauri', 'target', 'release', 'bundle', 'msi')
    const installerAssetName = 'StreamDash-Setup.msi'
    const installerAsset = join(bundleDirectory, installerAssetName)
    const signatureAsset = `${installerAsset}.sig`
    const signature = (await readFile(signatureAsset, 'utf8')).trim()
    const manifest = {
      version,
      notes: (summary ?? '').trim(),
      pub_date: new Date().toISOString(),
      platforms: {
        'windows-x86_64': {
          signature,
          url: `https://github.com/${repo}/releases/download/${tag}/${installerAssetName}`,
        },
      },
    }
    const manifestPath = join(bundleDirectory, 'latest.json')
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
    progress.stop('Signed release artifacts are ready')

    const publish = p.spinner()
    publish.start('Committing the release version')
    await run('git', ['add', ...versionFiles])
    await run('git', ['commit', '-m', `chore: release ${tag}`])
    committed = true
    await run('git', ['tag', '-a', tag, '-m', `StreamDash ${version}`])
    publish.message('Pushing main and the release tag')
    await run('git', ['push', '--atomic', 'origin', 'main', tag])
    publish.message('Publishing the GitHub release and update manifest')
    await run('gh', [
      'release', 'create', tag,
      installerAsset,
      signatureAsset,
      manifestPath,
      '--repo', repo,
      '--title', `StreamDash ${version}`,
      '--notes', (summary ?? '').trim(),
      '--generate-notes',
      '--verify-tag',
      '--latest',
    ])
    publish.stop(`StreamDash ${version} is published`)
    p.outro(`https://github.com/${repo}/releases/tag/${tag}`)
  } catch (error) {
    if (!committed) {
      await Promise.all([...snapshots].map(([file, content]) => writeFile(join(root, file), content)))
    }
    throw error
  }
}

main().catch((error) => {
  p.log.error(error instanceof Error ? error.message : String(error))
  p.outro('Release failed. Nothing was published unless the error explicitly occurred during the push or GitHub release step.')
  process.exitCode = 1
})
