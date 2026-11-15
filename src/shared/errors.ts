export class AppError extends Error {
  constructor(message: string, public statusCode = 500, public code = "INTERNAL_ERROR") {
    super(message);
    this.name = "AppError";
  }
}

export function safeErrorMessage(error: unknown) {
  return error instanceof Error ? error.message.slice(0, 500) : "Falha inesperada.";
}

