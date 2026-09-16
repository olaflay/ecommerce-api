import "express-async-errors";
import express, { Request, Response } from "express";
import helmet from "helmet";
import cors from "cors";
import { config } from "./config/index.js";
import { rateLimiter } from "./middleware/rateLimiter.js";
import { errorHandler } from "./middleware/errorHandler.js";
import healthRouter from "./routes/health.js";
import { NotFoundError } from "./types/index.js";

export const app = express();

// Set trust proxy for deployment behind reverse proxies (Render / Railway)
app.set("trust proxy", 1);

// Security headers & CORS
app.use(helmet());
app.use(
  cors({
    origin: config.CORS_ALLOWED_ORIGINS,
    credentials: true,
  })
);

// Body parser with 100kb payload ceiling
app.use(express.json({ limit: "100kb" }));

// Rate limiter placed early before business logic / DB
app.use(rateLimiter);

// Health check routes (unrestricted)
app.use(healthRouter);
app.use("/api/v1", healthRouter);

// Unmatched route 404 handler
app.use((_req: Request, _res: Response) => {
  throw new NotFoundError("Route not found");
});

// Centralized error handler
app.use(errorHandler);
