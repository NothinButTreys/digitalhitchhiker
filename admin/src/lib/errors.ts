export class ApiError extends Error {
  constructor(
    readonly status: 400 | 401 | 403 | 404 | 409 | 413 | 415 | 502,
    readonly code: string,
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

export const badRequest = (code: string, message: string) => new ApiError(400, code, message);
export const unauthorized = () => new ApiError(401, "unauthorized", "Sign in to continue.");
export const forbidden = () => new ApiError(403, "forbidden", "This identity may not do that.");
export const notFound = (what: string) => new ApiError(404, "not_found", `No such ${what}.`);
export const conflict = (code: string, message: string, details: Record<string, unknown> = {}) =>
  new ApiError(409, code, message, details);
