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

function extensionOf(file: File): string {
  return file.name.toLowerCase().split(".").pop() ?? ""
}

/** The file's type if it is an allowed one. The name decides, and what the
    browser says has to agree with it when it says anything: a type alone is
    whatever the sender typed. */
export function logoType(file: File): string | null {
  const type = LOGO_TYPE_BY_EXTENSION[extensionOf(file)]
  if (!type) return null
  return !file.type || file.type === type ? type : null
}

/** A name of ours for the file, keeping only its checked extension. */
export function logoFilename(file: File, base: string): string {
  return `${base}.${extensionOf(file)}`
}
