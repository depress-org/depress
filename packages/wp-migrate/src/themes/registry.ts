import { astrowindAdapter } from './astrowind.js'
import { rocketAdapter } from './rocket.js'
import { brookAdapter } from './brook.js'
import { daisyuiAdapter } from './daisyui.js'
import { mainlineAdapter } from './mainline.js'
import { smallBizAdapter } from './small-biz.js'
import type { ThemeAdapter } from './types.js'

/**
 * AstroWind is the default theme — bundled in bundled-themes/astrowind/ so it
 * never requires a network download and the version is frozen in the repo.
 *
 * The remaining themes are fetched from GitHub at generation time.
 * Pass --theme <id> to select one; omitting --theme (or passing "default" /
 * "astrowind") picks AstroWind.
 */
export const THEMES: ThemeAdapter[] = [
  astrowindAdapter,   // default — bundled, no download needed
  rocketAdapter,
  smallBizAdapter,
  brookAdapter,
  daisyuiAdapter,
  mainlineAdapter,
]

export const DEFAULT_THEME_ID = 'astrowind'

export function getThemeAdapter(id: string): ThemeAdapter | undefined {
  return THEMES.find((t) => t.id === id)
}

export function listThemes(): Array<{ id: string; name: string; description: string; bundled?: boolean }> {
  return THEMES.map(({ id, name, description, bundled }) => ({ id, name, description, bundled }))
}
