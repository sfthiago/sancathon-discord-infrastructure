import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { dirname, extname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourceDirectories = ["config", "src", "test", "scripts"];
const rootEntrypoints = ["setup.js", "audit.js"];

async function findJavaScriptFiles(directory) {
  const absoluteDirectory = resolve(projectRoot, directory);
  if (!existsSync(absoluteDirectory)) {
    return [];
  }

  const entries = await readdir(absoluteDirectory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const child = resolve(absoluteDirectory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await findJavaScriptFiles(relative(projectRoot, child)));
    } else if (entry.isFile() && extname(entry.name) === ".js") {
      files.push(child);
    }
  }

  return files;
}

const discovered = (
  await Promise.all(sourceDirectories.map(findJavaScriptFiles))
).flat();
const entrypoints = rootEntrypoints
  .map((file) => resolve(projectRoot, file))
  .filter(existsSync);
const files = [...new Set([...entrypoints, ...discovered])]
  .sort((left, right) => left.localeCompare(right));

if (files.length === 0) {
  console.error("No JavaScript files were found for syntax checking.");
  process.exitCode = 1;
} else {
  const failures = [];

  for (const file of files) {
    const result = spawnSync(process.execPath, ["--check", file], {
      cwd: projectRoot,
      encoding: "utf8",
      windowsHide: true,
    });

    if (result.status !== 0) {
      failures.push({
        file: relative(projectRoot, file),
        output: [result.stdout, result.stderr, result.error?.message]
          .filter(Boolean)
          .join("\n")
          .trim(),
      });
    }
  }

  if (failures.length > 0) {
    for (const failure of failures) {
      console.error(`Syntax check failed: ${failure.file}`);
      if (failure.output) console.error(failure.output);
    }
    console.error(`${failures.length} of ${files.length} JavaScript files failed.`);
    process.exitCode = 1;
  } else {
    console.log(`Syntax OK: ${files.length} JavaScript files checked.`);
  }
}
