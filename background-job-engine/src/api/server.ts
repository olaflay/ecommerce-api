import { app } from "./app.js";
import { config } from "../config/index.js";

const server = app.listen(config.port, () => {
  console.log(`[Task 2 API] Listening on port ${config.port} (${config.nodeEnv})`);
  console.log(`[Task 2 Dashboard] http://localhost:${config.port}`);
});

process.on("SIGINT", () => {
  server.close(() => {
    console.log("[Task 2 API] Server closed gracefully.");
    process.exit(0);
  });
});
