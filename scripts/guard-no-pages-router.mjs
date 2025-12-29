import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const ignoredDirs = new Set(["node_modules", ".next", ".git"]);
const forbiddenContent = ["next" + "/document", "<" + "Html"];

async function scanDirectory(dir) {
  const entries = await readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      if (ignoredDirs.has(entry.name)) {
        continue;
      }
      if (entry.name === "pages") {
        throw new Error(`Pages Router directory detected: ${fullPath}`);
      }
      await scanDirectory(fullPath);
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    const contents = await readFile(fullPath, "utf8");
    for (const token of forbiddenContent) {
      if (contents.includes(token)) {
        throw new Error(
          `Forbidden token "${token}" found in ${fullPath}`
        );
      }
    }
  }
}

await scanDirectory(root);
