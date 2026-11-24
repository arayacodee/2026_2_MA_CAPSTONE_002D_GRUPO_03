import app from "./app.js";
import { env } from "./config/env.js";
import { prisma } from "./lib/prisma.js";
import { startMailWorker } from './lib/mail-worker.js';

const stopMailWorker = startMailWorker();

const server = app.listen(env.PORT, () => {
  console.log(
    `Cronos API running on http://localhost:${env.PORT}`
  );
});

const shutdown = async (signal: string) => {
  console.log(`${signal} received. Shutting down...`);

  await stopMailWorker();
  await prisma.$disconnect();

  server.close(() => {
    process.exit(0);
  });
};

process.on("SIGINT", () => {
  void shutdown("SIGINT");
});

process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});
