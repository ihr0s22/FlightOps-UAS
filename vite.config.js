import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Vite config for FlightOps.
// `base: "./"` makes built asset paths relative, so the app works whether it's served from a domain
// root, a GitHub Pages project subpath (https://user.github.io/<repo>/), or opened locally. The app
// has no client-side router, so a relative base is safe.
export default defineConfig({
  base: "./",
  plugins: [react()],
  server: {
    host: true,   // expose on the LAN so the Claude app can reach it
    port: 5173,
    strictPort: true,
  },
});
