import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  root: path.resolve(import.meta.dirname),
  plugins: [react()],
  resolve: { alias: { buffer: "buffer/" } },
  define: { "process.env": {}, global: "globalThis" },
  server: { port: 5179, strictPort: true },
  build: { outDir: "dist", emptyOutDir: true },
});
