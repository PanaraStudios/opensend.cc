/** Legacy resource rows without a channel are email resources. */
export function rowChannel<T extends string>(row: {
  channel?: T
}): T | "email" {
  return row.channel ?? "email"
}
