import { cp, rm, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const projectRoot = process.cwd();
const nextStaticSource = path.join(projectRoot, ".next", "static");
const nextStaticTarget = path.join(
  projectRoot,
  ".next",
  "standalone",
  ".next",
  "static"
);
const publicSource = path.join(projectRoot, "public");
const publicTarget = path.join(projectRoot, ".next", "standalone", "public");

const copyDir = async (source, target) => {
  await rm(target, { recursive: true, force: true });
  await cp(source, target, { recursive: true });
};

const logCopy = (source, target) => {
  console.log(`Copied ${source} -> ${target}`);
};

const ensureDirExists = async (source) => {
  try {
    const info = await stat(source);
    return info.isDirectory();
  } catch (error) {
    return false;
  }
};

const run = async () => {
  if (await ensureDirExists(nextStaticSource)) {
    await copyDir(nextStaticSource, nextStaticTarget);
    logCopy(nextStaticSource, nextStaticTarget);
  } else {
    console.warn(`Skipping missing ${nextStaticSource}`);
  }

  if (existsSync(publicSource)) {
    await copyDir(publicSource, publicTarget);
    logCopy(publicSource, publicTarget);
  } else {
    console.warn(`Skipping missing ${publicSource}`);
  }
};

await run();
