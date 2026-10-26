import { mkdirSync, mkdtempSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import esbuild from 'esbuild'

const cacheRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../node_modules/.cache')

// Node's test runner cannot import JSX. Bundle the module under test so the
// regression can render the real component. The bundle stays inside this
// package so its external React import resolves.
export async function loadJsxModule(entry) {
  mkdirSync(cacheRoot, { recursive: true })
  const outfile = path.join(mkdtempSync(path.join(cacheRoot, 'calendar-jsx-')), 'module.mjs')
  await esbuild.build({
    entryPoints: [entry],
    bundle: true,
    format: 'esm',
    platform: 'node',
    outfile,
    jsx: 'automatic',
    packages: 'external',
    define: {
      'import.meta.env.VITE_API_URL': '""',
    },
  })
  return import(pathToFileURL(outfile).href)
}
