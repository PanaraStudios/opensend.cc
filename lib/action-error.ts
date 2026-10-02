export function actionError(error: unknown): string {
  if (
    error &&
    typeof error === "object" &&
    "data" in error &&
    typeof error.data === "string"
  )
    return error.data
  if (error && typeof error === "object" && "data" in error) {
    const data = error.data
    if (
      data &&
      typeof data === "object" &&
      "message" in data &&
      typeof data.message === "string"
    )
      return data.message
  }
  return error instanceof Error ? error.message : "Please try again"
}
