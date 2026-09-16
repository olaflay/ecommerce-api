import "express-async-errors";
import express, { Request, Response } from "express";
import helmet from "helmet";
import cors from "cors";
import { config } from "./config/index.js";
import { correlationIdMiddleware } from "./middleware/correlationId.js";
import { rateLimiter } from "./middleware/rateLimiter.js";
import { errorHandler } from "./middleware/errorHandler.js";
import healthRouter from "./routes/health.js";
import categoryRouter from "./routes/category.routes.js";
import productRouter from "./routes/product.routes.js";
import customerRouter from "./routes/customer.routes.js";
import orderRouter from "./routes/order.routes.js";
import { NotFoundError } from "./types/index.js";

export const app = express();

// Trust proxy for production deployment behind reverse proxies (Render / Railway)
app.set("trust proxy", 1);

// Attach request correlation ID early for end-to-end tracing
app.use(correlationIdMiddleware);

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

// Resource routers mounted under /api/v1
app.use("/api/v1/categories", categoryRouter);
app.use("/api/v1/products", productRouter);
app.use("/api/v1/customers", customerRouter);
app.use("/api/v1/orders", orderRouter);

// Unmatched route 404 handler
app.use((_req: Request, _res: Response) => {
  throw new NotFoundError("Route not found");
});

// Centralized error handler
app.use(errorHandler);
