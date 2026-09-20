export function actionError(error: unknown): string {
  if (
    error &&
    typeof error === "object" &&
    "data" in error &&
    typeof error.data === "string"
  )
    return error.data
  return error instanceof Error ? error.message : "Please try again"
}
