import { Request, Response, NextFunction } from "express";
import { ZodSchema, ZodError } from "zod";
import { BadRequestError, ValidationError } from "../types/index.js";

type RequestLocation = "body" | "query" | "params";

export function validate(schema: ZodSchema, location: RequestLocation = "body") {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      const parsed = schema.parse(req[location]);
      req[location] = parsed;
      next();
    } catch (err) {
      if (err instanceof ZodError) {
        const firstIssue = err.issues[0];
        const message = firstIssue
          ? `${firstIssue.path.length ? firstIssue.path.join(".") + ": " : ""}${firstIssue.message}`
          : "Validation error";

        if (location === "body") {
          next(new ValidationError(message, err.flatten().fieldErrors));
        } else {
          next(new BadRequestError(message, err.flatten().fieldErrors));
        }
        return;
      }
      next(err);
    }
  };
}
