import { CloudOffIcon, FileQuestionIcon } from "lucide-react"

/* Copy for HTTP status pages. Keep it short: what happened, what to do. */

export const STATUS = {
  notFound: {
    code: "404",
    icon: FileQuestionIcon,
    title: "This page was",
    titleEm: "not found.",
    description:
      "Check the URL, or go back home. The source is on GitHub if you were looking for the code.",
  },
  serverError: {
    code: "500",
    icon: CloudOffIcon,
    title: "Something",
    titleEm: "went wrong.",
    description:
      "We hit an error loading this page. Try again, or go back home.",
  },
} as const
