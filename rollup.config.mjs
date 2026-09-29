import commonjs from "@rollup/plugin-commonjs";
import json from "@rollup/plugin-json";
import nodeResolve from "@rollup/plugin-node-resolve";
import replace from "@rollup/plugin-replace";
import terser from "@rollup/plugin-terser";
import typescript from "@rollup/plugin-typescript";
import path from "node:path";
import url from "node:url";

/**
 * Rollup config for bin/plugin.js, used by scripts/build.mjs (which also
 * decides the plugin id and output folder).
 * @returns {import('rollup').RollupOptions & { output: import('rollup').OutputOptions }}
 */
export function createRollupConfig({ pluginId, outDir, isWatching }) {
  return {
    input: "src/plugin.ts",
    output: {
      file: path.join(outDir, "bin", "plugin.js"),
      format: "es",
      sourcemap: isWatching,
      sourcemapPathTransform: (relativeSourcePath, sourcemapPath) =>
        url.pathToFileURL(path.resolve(path.dirname(sourcemapPath), relativeSourcePath)).href,
    },
    // Optional native speed-ups of "ws" (used by socket.io-client); ws falls
    // back to pure JS when they are missing.
    external: ["bufferutil", "utf-8-validate"],
    onwarn(warning, warn) {
      // socket.io / engine.io use `this` at module level in their CJS builds.
      if (warning.code === "THIS_IS_UNDEFINED" || warning.code === "CIRCULAR_DEPENDENCY") {
        return;
      }
      warn(warning);
    },
    plugins: [
      replace({
        preventAssignment: true,
        values: { __PLUGIN_ID__: JSON.stringify(pluginId) },
      }),
      typescript({ mapRoot: isWatching ? "./" : undefined }),
      json(),
      nodeResolve({ browser: false, exportConditions: ["node"], preferBuiltins: true }),
      commonjs({ ignore: ["bufferutil", "utf-8-validate"] }),
      !isWatching && terser(),
      {
        name: "emit-module-package-file",
        generateBundle() {
          this.emitFile({ fileName: "package.json", source: `{ "type": "module" }`, type: "asset" });
        },
      },
    ],
  };
}
