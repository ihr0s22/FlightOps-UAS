import { fileURLToPath } from "node:url";
import path from "node:path";
import tailwindcss from "tailwindcss";
import autoprefixer from "autoprefixer";

const here = path.dirname(fileURLToPath(import.meta.url));

export default {
  // Pass an explicit config path so Tailwind finds it even when invoked from a parent directory.
  plugins: [tailwindcss(path.join(here, "tailwind.config.js")), autoprefixer],
};
