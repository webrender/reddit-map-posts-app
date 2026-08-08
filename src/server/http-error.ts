/** Thrown by route handlers to produce a specific HTTP status instead of a generic 500. */
export class HttpError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}
