import { POOL, type OwnedHero } from './heroes'

const KEY = 'idle-card-save-v2'

export interface SaveData {
  owned: OwnedHero[]
  teamIdx: number[]
  diamonds: number
  stage: number
  lastTs: number
}

export function loadSave(): SaveData | null {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as SaveData) : null
  } catch {
    return null
  }
}

export function writeSave(data: SaveData): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(data))
  } catch {
    // 隐私模式 / 配额满等场景:静默放弃
  }
}

export function clearSave(): void {
  try {
    localStorage.removeItem(KEY)
  } catch {
    /* noop */
  }
}

/** 丢弃卡池里已不存在的英雄,防止存档错位 */
export function sanitizeOwned(owned: OwnedHero[]): OwnedHero[] {
  return owned.filter((o) => POOL.some((h) => h.id === o.heroId))
}
