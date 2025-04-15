import path from "path"
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react-swc'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    proxy: {
      // string shorthand: /api -> http://localhost:3000/api
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        // Optionally rewrite path if needed, but likely not for simple /api proxy
        // rewrite: (path) => path.replace(/^\/api/, '') 
      },
    }
  },
  base: "./",
  build: {
    outDir: "dist"
  }
})
