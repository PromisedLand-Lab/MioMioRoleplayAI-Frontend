import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// Go 后端服务地址（开发模式通过代理转发，前端无需关心跨域）
const BACKEND = 'http://localhost:8081'

export default defineConfig({
  plugins: [vue()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: BACKEND, changeOrigin: true },
      '/ws': { target: BACKEND.replace('http', 'ws'), ws: true },
    },
  },
  build: {
    // 独立项目：构建产物输出到本项目 dist/，生产环境由独立静态服务器托管
    outDir: 'dist',
  },
})
