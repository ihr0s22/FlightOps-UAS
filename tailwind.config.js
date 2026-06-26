import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('tailwindcss').Config} */
export default {
  // Absolute, config-relative globs so class scanning works regardless of the process CWD.
  content: [
    path.join(here, "index.html"),
    path.join(here, "FlightOps-UAS.jsx"),
    path.join(here, "src/**/*.{js,jsx,ts,tsx}"),
  ],
  theme: { extend: {} },
  plugins: [],
};
