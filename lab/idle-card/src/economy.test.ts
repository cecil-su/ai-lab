import { describe, it, expect } from 'vitest'
import { idleGain, idleRate, IDLE_CAP_HOURS, growthMul, upgradeCost, winReward } from './economy'

describe('挂机经济 idleGain', () => {
  it('产率随关卡线性提升', () => {
    expect(idleRate(1)).toBe(0.25)
    expect(idleRate(4)).toBe(1)
  })

  it('按离线秒数 × 产率结算并向下取整', () => {
    expect(idleGain(100_000, 1)).toBe(25) // 100s × 0.25
    expect(idleGain(10_000, 4)).toBe(10) // 10s × 1
  })

  it('零或负时长收益为 0', () => {
    expect(idleGain(0, 5)).toBe(0)
    expect(idleGain(-5000, 5)).toBe(0)
  })

  it('超过封顶时长按封顶结算', () => {
    const capMs = IDLE_CAP_HOURS * 3600 * 1000
    const atCap = idleGain(capMs, 1)
    expect(idleGain(capMs * 10, 1)).toBe(atCap) // 离线 80h 仍只结算 8h
  })
})

describe('养成 growthMul / upgradeCost', () => {
  it('成长倍率每级 +10%', () => {
    expect(growthMul(1)).toBe(1)
    expect(growthMul(2)).toBeCloseTo(1.1)
    expect(growthMul(6)).toBeCloseTo(1.5)
  })

  it('升级花费随当前等级递增', () => {
    expect(upgradeCost(1)).toBe(50)
    expect(upgradeCost(3)).toBe(150)
  })

  it('通关奖励随关卡递增', () => {
    expect(winReward(1)).toBe(40)
    expect(winReward(5)).toBe(80)
  })
})
