/* URLs a user supplies are fetched from inside the deployment, so they must
   name a public host: never an address on the server's own network, its
   loopback, or a cloud metadata service. The hostname is checked when the URL
   is saved, and every address it resolves to is checked before each fetch. */

const LOCAL_SUFFIXES = [".localhost", ".local", ".internal", ".arpa"]

/** Only the installation's explicit development endpoints may opt out. */
export function localHttpOrigin(input: string): string | undefined {
  const url = new URL(input)
  return url.protocol === "http:" &&
    !url.username &&
    !url.password &&
    ["localhost", "127.0.0.1", "host.docker.internal"].includes(url.hostname)
    ? url.origin
    : undefined
}

/** A DNS name on the public internet: not an IP literal, and not a name
    that only resolves on a local network. Takes `URL.hostname`, which has
    already turned hex and octal IPv4 spellings into dotted decimal. */
export function isPublicHostname(hostname: string): boolean {
  const name = hostname.toLowerCase().replace(/\.$/, "")
  return (
    name.includes(".") &&
    !name.includes(":") &&
    !name.startsWith("[") &&
    !/^[\d.]+$/.test(name) &&
    name !== "localhost" &&
    !LOCAL_SUFFIXES.some((suffix) => name.endsWith(suffix))
  )
}

// Special-purpose IPv4 ranges (RFC 6890 and successors) as [first octets, prefix].
const PRIVATE_V4: [number[], number][] = [
  [[0], 8],
  [[10], 8],
  [[100, 64], 10],
  [[127], 8],
  [[169, 254], 16],
  [[172, 16], 12],
  [[192, 0, 0], 24],
  [[192, 0, 2], 24],
  [[192, 88, 99], 24],
  [[192, 168], 16],
  [[198, 18], 15],
  [[198, 51, 100], 24],
  [[203, 0, 113], 24],
  [[224], 4],
  [[240], 4],
]

function parseV4(ip: string): number | null {
  const parts = ip.split(".")
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part)))
    return null
  const octets = parts.map(Number)
  if (octets.some((octet) => octet > 255)) return null
  return octets.reduce((value, octet) => value * 256 + octet, 0)
}

function publicV4(value: number) {
  return !PRIVATE_V4.some(([octets, prefix]) => {
    const base = [...octets, 0, 0, 0].slice(0, 4)
    const start = base.reduce((sum, octet) => sum * 256 + octet, 0)
    const size = 2 ** (32 - prefix)
    return value >= start && value < start + size
  })
}

/** Eight 16-bit groups, or null. Accepts `::` and a trailing dotted IPv4. */
function parseV6(ip: string): number[] | null {
  let text = ip.replace(/^\[|\]$/g, "").replace(/%.*$/, "")
  const dotted = text.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/)
  if (dotted) {
    const v4 = parseV4(dotted[2])
    if (v4 === null) return null
    text = `${dotted[1]}${(v4 >>> 16).toString(16)}:${(v4 & 0xffff).toString(16)}`
  }
  const halves = text.split("::")
  if (halves.length > 2) return null
  const groups = halves.map((half) => (half ? half.split(":") : []))
  if (groups.flat().some((group) => !/^[0-9a-f]{1,4}$/i.test(group)))
    return null
  const missing = 8 - groups.flat().length
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null
  return [
    ...groups[0],
    ...(halves.length === 2 ? [...Array(missing).fill("0"), ...groups[1]] : []),
  ].map((group) => parseInt(group, 16))
}

/** True only for a globally routable unicast address. Anything unparseable
    counts as private. */
export function isPublicAddress(ip: string): boolean {
  const v4 = parseV4(ip)
  if (v4 !== null) return publicV4(v4)
  const g = parseV6(ip)
  if (!g) return false
  const embedded = (hi: number, lo: number) => publicV4(hi * 65536 + lo)
  // IPv4-mapped (::ffff:a.b.c.d): the IPv4 address is what gets reached.
  if (g.slice(0, 5).every((group) => group === 0) && g[5] === 0xffff)
    return embedded(g[6], g[7])
  // Only global unicast (2000::/3) is public at all.
  if (g[0] < 0x2000 || g[0] > 0x3fff) return false
  // IETF protocol assignments, Teredo, ORCHID (2001::/23), documentation.
  if (g[0] === 0x2001 && (g[1] < 0x200 || g[1] === 0xdb8)) return false
  // 6to4 tunnels to the IPv4 address in the next 32 bits.
  if (g[0] === 0x2002) return embedded(g[1], g[2])
  return true
}
