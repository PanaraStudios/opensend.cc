/* Shared chrome for the policy pages: narrow measure, h4 section titles,
   muted small body copy. */
export function LegalPage({
  title,
  updated,
  children,
}: {
  title: string
  updated: string
  children: React.ReactNode
}) {
  return (
    <article className="px-6 py-16 md:px-10 md:py-20">
      <div className="mx-auto flex max-w-2xl flex-col gap-10">
        <div className="flex flex-col gap-2">
          <h1>{title}</h1>
          <p className="text-small text-faint-foreground">
            Last updated: {updated}
          </p>
        </div>
        {children}
      </div>
    </article>
  )
}

export function LegalSection({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-h4">{title}</h2>
      <div className="flex flex-col gap-2 text-small leading-relaxed text-muted-foreground">
        {children}
      </div>
    </section>
  )
}
