import * as esbuild from "https://deno.land/x/esbuild@v0.17.11/mod.js";
import { denoPlugins } from "../mod.ts";

await esbuild.build({
  plugins: [...denoPlugins()],
  entryPoints: ["https://deno.land/std@0.173.0/bytes/mod.ts"],
  outfile: "./dist/bytes.esm.js",
  bundle: true,
  format: "esm",
});
esbuild.stop();
