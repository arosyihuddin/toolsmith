import { startApplication } from "./app";

const application = await startApplication();

process.once("SIGINT", () => void application.shutdown("SIGINT"));
process.once("SIGTERM", () => void application.shutdown("SIGTERM"));
