import pino from "pino";
import { mkdirSync } from "node:fs";
import { config } from "./config";

const isProduction = config.nodeEnv === "production";
let destination: pino.DestinationStream | undefined;
if (config.logDirectory) {
  mkdirSync(config.logDirectory, { recursive: true });
  destination = pino.destination({ dest: config.logDirectory + "/toolsmith.log", mkdir: true, sync: false });
}

export const logger = pino({
  level: config.logLevel,
  base: undefined,
  timestamp: pino.stdTimeFunctions.isoTime,
  ...(isProduction
    ? {}
    : {
        transport: {
          target: "pino-pretty",
          options: {
            colorize: true,
            translateTime: "HH:MM:ss.l",
            ignore: "pid,hostname",
            destination: 2,
          },
        },
      }),
}, destination);
