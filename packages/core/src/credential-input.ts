/** Attributes shared by ID and secret fields, including masked/revealed secrets. */
export function credentialInputProps(secret = false) {
  return {
    autoComplete: secret ? "new-password" : "off",
    "data-1p-ignore": true,
    "data-lpignore": "true",
    "data-bwignore": "true",
    spellCheck: false,
  } as const
}
