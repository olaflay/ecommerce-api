import { Response } from "express";
import { CollectionResponse, SingleResponse, MetaPagination } from "../types/index.js";

export function sendCollection<T>(
  res: Response,
  data: T[],
  meta: MetaPagination,
  statusCode = 200
): void {
  const payload: CollectionResponse<T> = {
    data,
    meta,
  };
  res.status(statusCode).json(payload);
}

export function sendSingle<T>(
  res: Response,
  data: T,
  statusCode = 200
): void {
  const payload: SingleResponse<T> = {
    data,
  };
  res.status(statusCode).json(payload);
}

export function sendNoContent(res: Response): void {
  // PRD §7: 204 No Content responses have no body at all
  res.status(204).end();
}
