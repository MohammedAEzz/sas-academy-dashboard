export class AppError extends Error {
  constructor(code, message, status = 400, details = null) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export function mapStorageError(error) {
  if (error instanceof AppError) throw error;
  if (error?.code === "23505") {
    throw new AppError(
      "CONFLICT",
      "A record with this key was saved by another import. Preview the file again.",
      409,
    );
  }
  if (typeof error?.code === "string" && /^[0-9A-Z]{5}$/.test(error.code)) {
    console.error("storage_error", error.code);
    throw new AppError("STORAGE", "Storage is temporarily unavailable.", 500);
  }
  throw error;
}
