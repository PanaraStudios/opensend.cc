"use client"

import { useTheme } from "next-themes"

import { Moon, Sun } from "@/components/marketing/icons"
import { Button } from "@/components/ui/button"
import { Kbd } from "@/components/ui/kbd"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme()

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            aria-label="Toggle theme"
            onClick={() =>
              setTheme(resolvedTheme === "dark" ? "light" : "dark")
            }
          />
        }
      >
        <Sun className="dark:hidden" />
        <Moon className="hidden dark:block" />
      </TooltipTrigger>
      <TooltipContent>
        Toggle theme
        <Kbd>D</Kbd>
      </TooltipContent>
    </Tooltip>
  )
}
