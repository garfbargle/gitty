import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  root: "web-demo",
  publicDir: "../public",
  plugins: [react()],
  build: {
    outDir: "../dist-demo",
    emptyOutDir: true,
  },
});

