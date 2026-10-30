type IvrAction = { kind: string; botId?: string }
export type IvrBotRoutes = {
  menus: Array<{
    options: Record<string, IvrAction>
    noInputAction: IvrAction
    failureAction: IvrAction
  }>
  businessHours?: { closedAction: IvrAction }
}
/** Every voice bot an IVR routes to: menu options, no-input and failure
    actions, and the closed-hours action. */
export function ivrBotIds(ivr: IvrBotRoutes): string[] {
  const actions = [
    ...ivr.menus.flatMap((menu) => [
      ...Object.values(menu.options),
      menu.noInputAction,
      menu.failureAction,
    ]),
    ...(ivr.businessHours ? [ivr.businessHours.closedAction] : []),
  ]
  return [
    ...new Set(
      actions.flatMap((action) =>
        action.kind === "bot" && action.botId ? [action.botId] : []
      )
    ),
  ]
}
