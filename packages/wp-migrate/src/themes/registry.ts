import { rocketAdapter } from './rocket.js'
import { brookAdapter } from './brook.js'
import { daisyuiAdapter } from './daisyui.js'
import { mainlineAdapter } from './mainline.js'
import { smallBizAdapter } from './small-biz.js'
import type { ThemeAdapter } from './types.js'

export const THEMES: ThemeAdapter[] = [
  rocketAdapter,
  smallBizAdapter,
  brookAdapter,
  daisyuiAdapter,
  mainlineAdapter,
]

export function getThemeAdapter(id: string): ThemeAdapter | undefined {
  return THEMES.find((t) => t.id === id)
}

export function listThemes(): Array<{ id: string; name: string; description: string }> {
  return THEMES.map(({ id, name, description }) => ({ id, name, description }))
}
