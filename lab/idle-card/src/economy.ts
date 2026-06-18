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
