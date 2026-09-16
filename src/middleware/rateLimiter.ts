import rateLimit from "express-rate-limit";
import { config } from "../config/index.js";
import { ErrorEnvelope } from "../types/index.js";

export const rateLimiter = rateLimit({
  windowMs: config.RATE_LIMIT_WINDOW_MS,
  max: config.RATE_LIMIT_MAX_REQUESTS,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.path === "/healthz" || req.path === "/api/v1/healthz",
  handler: (_req, res) => {
    const retryAfter = Math.ceil(config.RATE_LIMIT_WINDOW_MS / 1000);
    res.setHeader("Retry-After", String(retryAfter));
    res.status(429).json({
      error: {
        code: "RATE_LIMITED",
        message: "Too many requests. Please try again later.",
      },
    } satisfies ErrorEnvelope);
  },
});
