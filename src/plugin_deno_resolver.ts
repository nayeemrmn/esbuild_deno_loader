import {
  esbuild,
  ImportMap,
  resolveImportMap,
  resolveModuleSpecifier,
  Scopes,
  SpecifierMap,
  toFileUrl,
} from "../deps.ts";
import { readDenoConfig, urlToEsbuildResolution } from "./shared.ts";

export type { ImportMap, Scopes, SpecifierMap };

export interface DenoResolverPluginOptions {
  /**
   * Specify the path to a deno.json config file to use. This is equivalent to
   * the `--config` flag to the Deno executable. This path must be absolute.
   */
  configPath?: string;
  /**
   * Specify a URL to an import map file to use when resolving import
   * specifiers. This is equivalent to the `--import-map` flag to the Deno
   * executable. This URL may be remote or a local file URL.
   *
   * If this option is not specified, the deno.json config file is consulted to
   * determine what import map to use, if any.
   */
  importMapURL?: string;
}

/**
 * The Deno resolver plugin performs relative->absolute specifier resolution
 * and import map resolution.
 *
 * If using the {@link denoLoaderPlugin}, this plugin must be used before the
 * loader plugin.
 */
export function denoResolverPlugin(
  options: DenoResolverPluginOptions = {},
): esbuild.Plugin {
  return {
    name: "deno-resolver",
    setup(build) {
      let importMap: ImportMap | null = null;

      build.onStart(async function onStart() {
        let importMapURL: string | undefined;

        // If no import map URL is specified, and a config is specified, we try
        // to get an import map from the config.
        if (
          options.importMapURL === undefined && options.configPath !== undefined
        ) {
          const config = await readDenoConfig(options.configPath);
          // If `imports` or `scopes` are specified, use the config file as the
          // import map directly.
          if (config.imports !== undefined || config.scopes !== undefined) {
            importMap = resolveImportMap(
              // deno-lint-ignore no-explicit-any
              config as any,
              toFileUrl(options.configPath),
            );
          } else if (config.importMap !== undefined) {
            // Otherwise, use the import map URL specified in the config file
            importMapURL =
              new URL(config.importMap, toFileUrl(options.configPath)).href;
          }
        } else if (options.importMapURL !== undefined) {
          importMapURL = options.importMapURL;
        }

        // If we have an import map URL, fetch it and parse it.
        if (importMapURL) {
          const resp = await fetch(importMapURL);
          const data = await resp.json();
          importMap = resolveImportMap(data, new URL(resp.url));
        }
      });

      build.onResolve({ filter: /.*/ }, async function onResolve(args) {
        // The first pass resolver performs synchronous resolution. This
        // includes relative to absolute specifier resolution and import map
        // resolution.

        // We have to first determine the referrer URL to use when resolving
        // the specifier. This is either the importer URL, or the resolveDir
        // URL if the importer is not specified (ie if the specifier is at the
        // root).
        let referrer: URL;
        if (args.importer !== "") {
          if (args.namespace === "") {
            throw new Error("[assert] namespace is empty");
          }
          referrer = new URL(`${args.namespace}:${args.importer}`);
        } else if (args.resolveDir !== "") {
          referrer = new URL(`${toFileUrl(args.resolveDir).href}/`);
        } else {
          return undefined;
        }

        // We can then resolve the specifier relative to the referrer URL. If
        // an import map is specified, we use that to resolve the specifier.
        let resolved: URL;
        if (importMap !== null) {
          const res = resolveModuleSpecifier(
            args.path,
            importMap,
            new URL(referrer) || undefined,
          );
          resolved = new URL(res);
        } else {
          resolved = new URL(args.path, referrer);
        }

        // Now pass the resolved specifier back into the resolver, for a second
        // pass. Now plugins can perform any resolution they want on the fully
        // resolved specifier.
        const { path, namespace } = urlToEsbuildResolution(resolved);
        return await build.resolve(path, {
          namespace,
          kind: args.kind,
        });
      });
    },
  };
}
