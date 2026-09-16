import { Request, Response, NextFunction } from "express";
import { randomUUID } from "node:crypto";

export const correlationIdMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const existingId = req.headers["x-request-id"];
  const correlationId =
    typeof existingId === "string" && existingId.trim()
      ? existingId.trim()
      : randomUUID();

  (req as Request & { correlationId: string }).correlationId = correlationId;
  res.setHeader("X-Request-Id", correlationId);
  next();
};
