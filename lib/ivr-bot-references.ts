type IvrAction = { kind: string; botId?: string }
export type IvrBotRoutes = {
  menus: Array<{
    options: Record<string, IvrAction>
    noInputAction: IvrAction
    failureAction: IvrAction
  }>
  businessHours?: { closedAction: IvrAction }
}
export function ivrRoutesToBot(ivr: IvrBotRoutes, botId: string): boolean {
  const hits = (action?: IvrAction) =>
    action?.kind === "bot" && action.botId === botId
  if (hits(ivr.businessHours?.closedAction)) return true
  return ivr.menus.some(
    (menu) =>
      hits(menu.noInputAction) ||
      hits(menu.failureAction) ||
      Object.values(menu.options).some(hits)
  )
}
