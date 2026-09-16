import { Request, Response, NextFunction, ErrorRequestHandler } from "express";
import { Prisma } from "@prisma/client";
import { ZodError } from "zod";
import { randomUUID } from "node:crypto";
import { AppError, ErrorEnvelope } from "../types/index.js";

export const errorHandler: ErrorRequestHandler = (
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction
): void => {
  // Syntax error from body-parser (e.g., malformed JSON)
  if (err instanceof SyntaxError && "status" in err && (err as { status: unknown }).status === 400) {
    res.status(400).json({
      error: {
        code: "BAD_REQUEST",
        message: "Malformed JSON in request body",
      },
    } satisfies ErrorEnvelope);
    return;
  }

  // Application-defined domain error
  if (err instanceof AppError) {
    const payload: ErrorEnvelope = {
      error: {
        code: err.code,
        message: err.message,
        ...(err.details ? { details: err.details } : {}),
      },
    };
    res.status(err.statusCode).json(payload);
    return;
  }

  // Zod validation error
  if (err instanceof ZodError) {
    res.status(422).json({
      error: {
        code: "VALIDATION_ERROR",
        message: "Request validation failed",
        details: err.flatten().fieldErrors,
      },
    } satisfies ErrorEnvelope);
    return;
  }

  // Prisma known request errors
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P2002") {
      const target = Array.isArray(err.meta?.target)
        ? (err.meta.target as string[]).join(", ")
        : "unique constraint";
      res.status(409).json({
        error: {
          code: "CONFLICT",
          message: `A record with this ${target} already exists`,
        },
      } satisfies ErrorEnvelope);
      return;
    }

    if (err.code === "P2025") {
      res.status(404).json({
        error: {
          code: "NOT_FOUND",
          message: "Requested resource not found",
        },
      } satisfies ErrorEnvelope);
      return;
    }
  }

  // Unexpected internal server error (500)
  const correlationId =
    (req as Request & { correlationId?: string }).correlationId ||
    (req.headers["x-request-id"] as string) ||
    randomUUID();
  console.error(`[INTERNAL_ERROR][${correlationId}]`, err);

  res.status(500).json({
    error: {
      code: "INTERNAL_ERROR",
      message: "Internal server error",
    },
  } satisfies ErrorEnvelope);
};
