import { POOL, type Hero } from './heroes'

const KEY = 'idle-card-save-v1'

export interface SaveData {
  ownedIds: string[]
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

/** 存档只存英雄 id,从卡池还原成 Hero 对象 */
export function rehydrateOwned(ids: string[]): Hero[] {
  return ids.map((id) => POOL.find((h) => h.id === id)).filter((h): h is Hero => !!h)
}
