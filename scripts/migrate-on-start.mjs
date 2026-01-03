import { execFileSync } from "node:child_process";
import { URL } from "node:url";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl || databaseUrl.trim() === "") {
  console.error(
    "DATABASE_URL is required before running Prisma migrations. Set DATABASE_URL and rerun.",
  );
  process.exit(1);
}

let parsedUrl;
try {
  parsedUrl = new URL(databaseUrl);
} catch (error) {
  console.error("DATABASE_URL is not a valid URL. Check the environment configuration.");
  process.exit(1);
}

const dbHost = parsedUrl.hostname || "unknown-host";
const dbPort = parsedUrl.port ? `:${parsedUrl.port}` : "";
const dbName = parsedUrl.pathname?.replace(/^\/+/, "") || "unknown-db";
const targetSummary = `${dbHost}${dbPort}/${dbName}`;

if (process.env.NODE_ENV === "production") {
  if (/localhost|127\.0\.0\.1/i.test(dbHost) || /localhost/i.test(databaseUrl)) {
    console.error(
      "DATABASE_URL points to localhost in production. Refusing to run migrations.",
    );
    process.exit(1);
  }
}

console.log(`Running Prisma migrations against ${targetSummary}...`);

try {
  execFileSync("npx", ["prisma", "migrate", "deploy"], { stdio: "inherit" });
} catch (error) {
  console.error("Prisma migrate deploy failed. See logs above for details.");
  process.exit(1);
}

console.log("Ensuring Prisma client is generated...");

try {
  execFileSync("npx", ["prisma", "generate"], { stdio: "inherit" });
} catch (error) {
  console.error("Prisma generate failed. See logs above for details.");
  process.exit(1);
}
