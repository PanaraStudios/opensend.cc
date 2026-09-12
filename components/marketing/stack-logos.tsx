import Image from "next/image"

import { cn } from "@/lib/utils"

/* Brand marks for the stack marquee. Each mark ships as a light + dark pair
   in public/logos/stack, normalized to a 24x24 canvas: the mark's tight
   bounding box is centered with its longest side filling the box, so every
   tile reads at the same optical size. Monochrome marks (Next.js, AWS)
   flip to white in the dark variant; Better Auth's square inverts;
   full-color marks are identical in both. The pair is swapped by the
   .dark class, and next/image serves .svg sources as-is. */
export type StackLogo = {
  /** File stem under /logos/stack, e.g. "convex" -> convex-light.svg */
  id: string
  name: string
}

export const STACK_LOGOS: StackLogo[] = [
  { id: "nextjs", name: "Next.js" },
  { id: "convex", name: "Convex" },
  { id: "better-auth", name: "Better Auth" },
  { id: "aws", name: "AWS SES" },
  { id: "docker", name: "Docker Compose" },
]

export function StackLogoMark({
  logo,
  className,
}: {
  logo: StackLogo
  className?: string
}) {
  return (
    <>
      <Image
        src={`/logos/stack/${logo.id}-light.svg`}
        alt=""
        width={24}
        height={24}
        className={cn("dark:hidden", className)}
      />
      <Image
        src={`/logos/stack/${logo.id}-dark.svg`}
        alt=""
        width={24}
        height={24}
        className={cn("hidden dark:block", className)}
      />
    </>
  )
}
