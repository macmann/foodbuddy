import pino from "pino";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  serializers: {
    err: pino.stdSerializers.err,
  },
  redact: {
    paths: [
      "*.password",
      "*.token",
      "*.secret",
      "authorization",
      "cookie",
      "set-cookie",
    ],
    remove: true,
  },
});
