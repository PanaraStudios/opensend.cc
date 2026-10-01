export type IvrRouteAction =
  | { kind: "submenu"; menuId: string }
  | { kind: "agents" }
  | { kind: "bot"; botId: string }
  | { kind: "voicemail" }
  | { kind: "playAndHangup" }
  | { kind: "hangup" }
export interface IvrDecision {
  step: number
  organizationId: string
  action: IvrRouteAction
  extension?: string
  promptUrl?: string
  menu?: {
    id: string
    promptUrl: string
    invalidUrl?: string
    timeoutSeconds: number
    retries: number
    maxDigits: number
    digits: string[]
  }
}
