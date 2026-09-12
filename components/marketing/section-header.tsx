import { Reveal } from "@/components/marketing/motion"
import { cn } from "@/lib/utils"

/* Centered section header: the 48/52 gradient title, then 12px down to the
   18px description. Rises into view as one block. Content follows at
   mt-14. */
export function SectionHeader({
  title,
  description,
  className,
  titleClassName,
}: {
  title: React.ReactNode
  description?: string
  className?: string
  titleClassName?: string
}) {
  return (
    <Reveal
      className={cn(
        "mx-auto flex max-w-2xl flex-col items-center text-center",
        className
      )}
    >
      <h2
        className={cn(
          "title-gradient pb-1 text-5xl/13 text-balance max-md:text-[2rem] max-md:leading-[1.1]",
          titleClassName
        )}
      >
        {title}
      </h2>
      {description ? (
        <p className="mt-3 max-w-xl text-body-lg text-balance text-foreground">
          {description}
        </p>
      ) : null}
    </Reveal>
  )
}
