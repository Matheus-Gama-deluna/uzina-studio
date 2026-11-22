#!/usr/bin/env node
import path from "node:path";
import { pathToFileURL } from "node:url";
import { runCli } from "./cli.js";

export * from "./cli.js";

const isDirectEntry =
  typeof process.argv[1] === "string" &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isDirectEntry) {
  runCli(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((err) => {
      console.error(err instanceof Error ? err.message : String(err));
      process.exitCode = 1;
    });
}
