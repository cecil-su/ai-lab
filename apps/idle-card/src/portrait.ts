import type { Rarity } from './battle/types'

// 品质配色:R 蓝 / SR 紫 / SSR 金 —— 卡牌游戏的"一眼分高低"
const PALETTE: Record<Rarity, { a: string; b: string; ink: string }> = {
  R: { a: '#3b6fd4', b: '#1b2b5e', ink: '#cfe0ff' },
  SR: { a: '#9b5cf0', b: '#3a1f6e', ink: '#ecd9ff' },
  SSR: { a: '#f5b84a', b: '#7a4410', ink: '#fff3cf' },
}

/**
 * 生成一张占位"立绘"(SVG data URI):渐变底 + 书法体姓名字 + 高光。
 * 这是给你看"框进卡里的质感"用的——以后把 src 换成 AI 生成的真立绘即可,组件不用动。
 */
export function portraitUri(nameChar: string, rarity: Rarity): string {
  const c = PALETTE[rarity]
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120">
    <defs>
      <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="${c.a}"/><stop offset="1" stop-color="${c.b}"/>
      </linearGradient>
      <radialGradient id="h" cx="0.5" cy="0.28" r="0.75">
        <stop offset="0" stop-color="rgba(255,255,255,0.5)"/>
        <stop offset="1" stop-color="rgba(255,255,255,0)"/>
      </radialGradient>
    </defs>
    <rect width="120" height="120" rx="14" fill="url(#g)"/>
    <rect width="120" height="120" rx="14" fill="url(#h)"/>
    <text x="60" y="86" font-size="70" font-family="STKaiti,KaiTi,serif" font-weight="700"
      text-anchor="middle" fill="${c.ink}" stroke="rgba(0,0,0,0.35)" stroke-width="2"
      paint-order="stroke">${nameChar}</text>
  </svg>`
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
}

export const RARITY_LABEL: Record<Rarity, string> = { R: 'R', SR: 'SR', SSR: 'SSR' }
