import { app } from "./app.js";
import { config } from "./config/index.js";
import { prisma } from "./db/prisma.js";

const server = app.listen(config.PORT, async () => {
  try {
    await prisma.$connect();
    console.log(
      `🚀 E-Commerce API running in ${config.NODE_ENV} mode on port ${config.PORT}`
    );
    console.log(`   Health check: http://localhost:${config.PORT}/healthz`);
  } catch (error) {
    console.error("❌ Failed to connect to database on startup:", error);
    process.exit(1);
  }
});

const shutdown = async (signal: string) => {
  console.log(`\nReceived ${signal}. Gracefully shutting down...`);
  server.close(async () => {
    try {
      await prisma.$disconnect();
      console.log("Database disconnected. Process exiting cleanly.");
      process.exit(0);
    } catch (err) {
      console.error("Error during database disconnect:", err);
      process.exit(1);
    }
  });
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
