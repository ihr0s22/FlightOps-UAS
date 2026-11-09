import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Vite config for FlightOps.
// `base: "./"` makes built asset paths relative, so the app works whether it's served from a domain
// root, a GitHub Pages project subpath (https://user.github.io/<repo>/), or opened locally. The app
// has no client-side router, so a relative base is safe.
export default defineConfig({
  base: "./",
  plugins: [react()],
  // Vitest covers the app only; the relay has its own node:test suite (run via `npm test` in relay/).
  test: { include: ["tests/**/*.test.js"] },
  server: {
    host: true,   // expose on the LAN
    port: 5173,
    strictPort: true,
  },
});
