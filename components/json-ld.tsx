/* JSON-LD for search engines and AI crawlers. Escapes `<` so a stray
   character in copy cannot break out of the script tag. */

type JsonLdData = {
  "@context": "https://schema.org"
  "@graph": readonly unknown[]
}

export function JsonLd({ data }: { data: JsonLdData }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{
        __html: JSON.stringify(data).replace(/</g, "\\u003c"),
      }}
    />
  )
}
