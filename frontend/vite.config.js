import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, searchForWorkspaceRoot } from 'vite'
import react from '@vitejs/plugin-react'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

export default defineConfig({
  plugins: [react()],
  server: {
    fs: { allow: [searchForWorkspaceRoot(process.cwd()), repoRoot] },
    host: '0.0.0.0',
    port: 5000,
    allowedHosts: ['www.herkulesgroup-china.com', 'localhost'],
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
      },
    },
  },
})
