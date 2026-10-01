import {
  messageTextParts,
  safeMessageUrl,
} from "@/lib/dashboard/conversation-content"
export function FormattedText({ text }: { text: string }) {
  return (
    <span className="wrap-break-word whitespace-pre-wrap">
      {messageTextParts(text).map((part, i) => {
        switch (part.kind) {
          case "bold":
            return (
              <strong key={i}>
                <FormattedText text={part.text} />
              </strong>
            )
          case "italic":
            return (
              <em key={i}>
                <FormattedText text={part.text} />
              </em>
            )
          case "strike":
            return (
              <s key={i}>
                <FormattedText text={part.text} />
              </s>
            )
          case "code":
            return <code key={i}>{part.text}</code>
          case "link":
            return (
              <a
                key={i}
                className="chat-link underline"
                href={safeMessageUrl(part.text)}
                target="_blank"
                rel="noopener noreferrer"
              >
                {part.text}
              </a>
            )
          default:
            return part.text
        }
      })}
    </span>
  )
}
