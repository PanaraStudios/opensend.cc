/* What a sponsor may upload as a logo. The form, the server action and the
   copy all read from here. */

export const LOGO_MAX_BYTES = 1_000_000

const LOGO_TYPE_BY_EXTENSION: Record<string, string> = {
  svg: "image/svg+xml",
  png: "image/png",
  webp: "image/webp",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
}

const LOGO_TYPES = new Set(Object.values(LOGO_TYPE_BY_EXTENSION))

/** For a file input's `accept`: the types, then the extensions. */
export const LOGO_ACCEPT = [
  ...LOGO_TYPES,
  ...Object.keys(LOGO_TYPE_BY_EXTENSION).map((extension) => `.${extension}`),
].join(",")

/** The file's type if it is an allowed one, going by its name when the
    browser sent none. */
export function logoType(file: File): string | null {
  const extension = file.name.toLowerCase().split(".").pop() ?? ""
  const type = file.type || LOGO_TYPE_BY_EXTENSION[extension] || ""
  return LOGO_TYPES.has(type) ? type : null
}
