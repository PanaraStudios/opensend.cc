"use client"

import { motion, MotionConfig } from "motion/react"
import type { Variants } from "motion/react"

/* The page's motion vocabulary, kept to one move: a 16px rise with a fade,
   600ms on an ease-out curve, played once as an element enters the
   viewport. Grids stagger that same move across their cells at 70ms.
   MotionConfig reducedMotion="user" turns the transforms off when the OS
   asks for reduced motion. */

const EASE = [0.22, 1, 0.36, 1] as const
const VIEWPORT = { once: true, margin: "0px 0px -12% 0px" } as const

export const rise: Variants = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0, transition: { duration: 0.6, ease: EASE } },
}

const stagger: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.07, delayChildren: 0.05 } },
}

export function MotionProvider({ children }: { children: React.ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>
}

/* One block that rises into view. */
export function Reveal({
  children,
  className,
  delay = 0,
}: {
  children: React.ReactNode
  className?: string
  delay?: number
}) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 16 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={VIEWPORT}
      transition={{ duration: 0.6, ease: EASE, delay }}
    >
      {children}
    </motion.div>
  )
}

/* A container whose StaggerItem children rise one after another. Put the
   layout classes (grid, flex) on the container; each item takes the cell's
   own classes so `.grid-cells > *` still targets the cell. */
export function Stagger({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <motion.div
      className={className}
      variants={stagger}
      initial="hidden"
      whileInView="show"
      viewport={VIEWPORT}
    >
      {children}
    </motion.div>
  )
}

export function StaggerItem({
  children,
  className,
  style,
}: {
  children: React.ReactNode
  className?: string
  style?: React.CSSProperties
}) {
  return (
    <motion.div className={className} style={style} variants={rise}>
      {children}
    </motion.div>
  )
}
