/** Zoom levels of the flow canvas (CSS zoom factors). */
export const ZOOM_STEPS = [0.5, 0.75, 1, 1.25] as const
/** 100%: the level a canvas opens at before it fits its graph. */
export const DEFAULT_ZOOM = 2
/** Below this a canvas doesn't open: smaller text is hard to read, and the
    reader can still zoom out or pan. */
export const MIN_OPEN_ZOOM = 1
/** The largest zoom step, from 75% up to 100%, that shows a graph this wide (at
    100%) inside the canvas with its padding; 75% if none does. */
export function fitZoom(naturalWidth: number, canvasWidth: number) {
  const padding = 80
  for (let step = DEFAULT_ZOOM; step > MIN_OPEN_ZOOM; step--)
    if (naturalWidth * ZOOM_STEPS[step] + padding <= canvasWidth) return step
  return MIN_OPEN_ZOOM
}
