import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
  plugins: [
    react(),
    mode === 'development' &&
    componentTagger(),
  ].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      // Remove React aliases to test if they interfere with provider context
      // 'react': path.resolve(__dirname, './node_modules/react'),
      // 'react-dom': path.resolve(__dirname, './node_modules/react-dom'),
    },
    // Add dedupe option for React to ensure single instance
    dedupe: ['react', 'react-dom'],
  },
  // Optimize dependencies might also help, but alias is more direct
  // optimizeDeps: {
  //   include: ['react', 'react-dom'],
  // },
}));
