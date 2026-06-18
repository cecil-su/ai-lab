// 挂机经济:产率随关卡提升,封顶 8 小时

export const DIAMOND_PER_SEC_PER_STAGE = 0.25
export const IDLE_CAP_HOURS = 8

/** 当前关卡的钻石产率(钻/秒) */
export function idleRate(stage: number): number {
  return DIAMOND_PER_SEC_PER_STAGE * stage
}

/** 给定离线时长(毫秒)结算可领取的钻石(向下取整,封顶) */
export function idleGain(elapsedMs: number, stage: number): number {
  const capMs = IDLE_CAP_HOURS * 3600 * 1000
  const ms = Math.min(Math.max(0, elapsedMs), capMs)
  return Math.floor((ms / 1000) * idleRate(stage))
}

// 养成:升级提升属性,花费随等级递增
export const UPGRADE_BASE_COST = 50
export const GROWTH_PER_LEVEL = 0.1

/** 等级属性倍率:Lv.1 = 1.0,每级 +10% 基础值 */
export function growthMul(level: number): number {
  return 1 + GROWTH_PER_LEVEL * (level - 1)
}

/** 从当前等级升到下一级的钻石花费 */
export function upgradeCost(level: number): number {
  return UPGRADE_BASE_COST * level
}
