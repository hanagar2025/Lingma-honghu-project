import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * 部署基路径。
 *
 * 默认 '/'（本机与局域网用）。挂到已有站点的子路径时必须显式指定，
 * 例如 hhwealth.cc 根目录已经跑着另一个应用，我们只能占一个子路径：
 *   BASE_PATH=/tios/ npm run build:offline
 *
 * 不设它的后果很具体：产物里的资源引用会是 /assets/xxx.js，
 * 部署到 /tios/ 之后浏览器去根目录找资源 → 全部 404 → 白屏，
 * 而且控制台之外没有任何提示。所以宁可让它成为一个显式参数。
 *
 * 末尾斜杠是 Vite 的要求；这里统一补上，避免因为少一个斜杠而白屏。
 */
const rawBase = process.env.BASE_PATH ?? '/'
const base = rawBase.endsWith('/') ? rawBase : `${rawBase}/`

export default defineConfig({
  base,
  plugins: [react()],
  server: {
    port: 5173,
    host: true,
    proxy: {
      '/api': {
        target: 'http://localhost:5000',
        changeOrigin: true
      }
    }
  },
  build: {
    outDir: 'dist',
    // 源码映射不随生产产物发布：它把完整源码还原出来，
    // 而这个页面要挂在公网上，多送一份源码没有必要。
    sourcemap: process.env.NODE_ENV !== 'production' && !process.env.BASE_PATH
  }
})
