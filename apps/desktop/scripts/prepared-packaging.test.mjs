import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, test } from 'vitest'
import * as prepared from './prepared-packaging.mjs'
import { validatePreparedBuilderArgs } from './run-electron-builder.mjs'
import { spawnSync } from 'node:child_process'

/** @type {string[]} */
const roots = []
afterEach(() => roots.splice(0).forEach(root => fs.rmSync(root, { recursive: true, force: true })))

/** @returns {{ source: string, out: string, electron: string, sevenZip: string, icons: string }} */
function fixture() {
  const source = fs.mkdtempSync(path.join(os.tmpdir(), 'prepared-packager-'))
  roots.push(source)
  const out = path.join(source, 'work')
  fs.mkdirSync(path.join(source, 'apps/desktop'), { recursive: true })
  fs.writeFileSync(path.join(source, 'package-lock.json'), '{}')
  fs.writeFileSync(path.join(source, 'apps/desktop/package.json'), '{}')
  fs.writeFileSync(path.join(source, 'apps/desktop/electron-builder.config.cjs'), 'module.exports = {}')
  const electron = path.join(out, 'electron.zip')
  const sevenZip = path.join(out, 'sevenZip')
  const icons = path.join(out, 'icons')
  fs.mkdirSync(path.join(sevenZip, 'bin'), { recursive: true })
  fs.mkdirSync(icons)
  fs.writeFileSync(electron, 'verified archive fixture')
  fs.writeFileSync(path.join(sevenZip, 'bin', process.platform === 'win32' ? '7za.exe' : '7za'), 'archive utility fixture')
  fs.writeFileSync(path.join(icons, 'icon-tool.js'), 'icon tool fixture')
  return { source, out, electron, sevenZip, icons }
}

test('a failed preparation invalidates an earlier completion claim before loading suppliers', () => {
  const { source, out } = fixture()
  const manifest = path.join(out, 'prepared.json')
  fs.writeFileSync(manifest, '{}')
  const result = spawnSync(process.execPath, [path.join(import.meta.dirname, 'prepare-packaging-tools.mjs'),
    '--source', source, '--out', out, '--cache', path.join(source, 'cache')], { encoding: 'utf8' })
  assert.notEqual(result.status, 0)
  assert.equal(fs.existsSync(manifest), false)
  assert.match(result.stderr, /lock|install|pinned/i)
})

test('prepared inputs are path-bound and reject changed or missing bytes without repair', async () => {
  const inputs = fixture()
  const manifest = await prepared.publishPackagingInputs({
    ...inputs, target: 'linux-x64', formats: ['dir'],
    toolsets: { sevenZip: inputs.sevenZip, icons: inputs.icons },
  })
  const result = prepared.readPackagingInputs(manifest, inputs.source, 'linux-x64')
  assert.equal(result.electron, inputs.electron)
  assert.throws(() => validatePreparedBuilderArgs([], result), /run preparation again/)
  assert.throws(() => validatePreparedBuilderArgs(['--dir', '-c.electronDist=/another.zip'], result), /run preparation again/)
  validatePreparedBuilderArgs(['--dir', '-c.extraMetadata.version=1.2.3'], result)
  fs.writeFileSync(inputs.electron, 'corrupt')
  assert.throws(() => prepared.readPackagingInputs(manifest, inputs.source, 'linux-x64'), /run preparation again/i)
  assert.equal(fs.readFileSync(inputs.electron, 'utf8'), 'corrupt')
  fs.rmSync(inputs.electron)
  assert.throws(() => prepared.readPackagingInputs(manifest, inputs.source, 'linux-x64'), /run preparation again/i)
})

test('relocated icon tools retain CommonJS scope under the ESM desktop package', () => {
  const { source, electron, sevenZip, icons } = fixture()
  const desktop = path.join(source, 'apps/desktop')
  fs.writeFileSync(path.join(desktop, 'package.json'), '{"type":"module"}')
  const packages = {}
  for (const name of ['app-builder-lib', 'electron-builder']) {
    const root = path.join(source, 'node_modules', name)
    fs.mkdirSync(root, { recursive: true })
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name, version: '1.0.0', main: 'index.js' }))
    fs.writeFileSync(path.join(root, 'index.js'), '')
    packages[`node_modules/${name}`] = { version: '1.0.0' }
  }
  fs.writeFileSync(path.join(source, 'package-lock.json'), JSON.stringify({ packages }))
  const supplier = path.join(source, 'node_modules/app-builder-lib/dist')
  fs.mkdirSync(path.join(supplier, 'util'), { recursive: true })
  fs.mkdirSync(path.join(supplier, 'toolsets'), { recursive: true })
  fs.writeFileSync(path.join(supplier, 'util/electronGet.js'),
    `exports.downloadElectronArtifactZip = async () => ${JSON.stringify(electron)}`)
  fs.writeFileSync(path.join(supplier, 'toolsets/7zip.js'),
    `exports.getPath7za = async () => ${JSON.stringify(path.join(sevenZip, 'bin', '7za'))}`)
  fs.writeFileSync(path.join(supplier, 'toolsets/icons.js'),
    `exports.getIconsToolsetPath = async () => ${JSON.stringify(icons)}`)
  fs.writeFileSync(path.join(icons, 'icon-tool.js'),
    'console.log(require("node:fs").existsSync(__filename) ? "icon tool ready" : "missing")')
  const out = path.join(desktop, 'build/prepared-packaging-tools')
  const args = [path.join(import.meta.dirname, 'prepare-packaging-tools.mjs'),
    '--source', source, '--out', out, '--cache', path.join(source, 'cache'), '--format', 'dir']
  // Every preparation replaces the tool directory, so the scope must survive a re-run too.
  for (let attempt = 0; attempt < 2; attempt++) {
    const preparedRun = spawnSync(process.execPath, args, { encoding: 'utf8' })
    assert.equal(preparedRun.status, 0, preparedRun.stderr)
    const receipt = prepared.readPackagingInputs(path.join(out, 'prepared.json'), source,
      `${process.platform}-${process.arch}`)
    const result = spawnSync(process.execPath, [path.join(receipt.toolsets.icons, 'icon-tool.js')], { encoding: 'utf8' })
    assert.equal(result.status, 0, result.stderr)
    assert.equal(result.stdout.trim(), 'icon tool ready')
  }
  assert.equal(fs.existsSync(path.join(icons, 'package.json')), false, 'leave the supplier unchanged')
})
