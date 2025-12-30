function logAndExit(event, error) {
  const message = error instanceof Error ? error.stack || error.message : error;
  // eslint-disable-next-line no-console
  console.error(`[process] ${event}`, message);
  process.exit(1);
}

process.on("uncaughtException", (error) => logAndExit("uncaughtException", error));
process.on("unhandledRejection", (error) => logAndExit("unhandledRejection", error));
