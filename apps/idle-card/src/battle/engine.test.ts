import { describe, it, expect } from 'vitest'
import { simulate } from './engine'
import type { BattleEvent, UnitInit } from './types'

// 测试工具:造一个单位,只覆盖关心的字段
const mk = (over: Partial<UnitInit> & Pick<UnitInit, 'id' | 'team'>): UnitInit => ({
  name: over.id,
  emoji: '🐱',
  rarity: 'R',
  maxHp: 1000,
  atk: 100,
  def: 0,
  speed: 100,
  skill: '技能',
  ...over,
})

const pick = <T extends BattleEvent['type']>(events: BattleEvent[], type: T) =>
  events.filter((e) => e.type === type) as Extract<BattleEvent, { type: T }>[]

describe('战斗内核 simulate', () => {
  // rng = () => 0   → 0 < 0.25,必定暴击
  // rng = () => 0.99 → 不暴击
  it('暴击翻倍,不暴击为原始伤害', () => {
    const atk = 100
    const A = mk({ id: 'A1', team: 'A', atk, def: 0, speed: 100, maxHp: 99999 })
    const B = mk({ id: 'B1', team: 'B', atk: 1, def: 0, speed: 1, maxHp: 99999 })

    const crit = pick(simulate([A, B], () => 0).events, 'damage')[0]
    expect(crit).toMatchObject({ value: atk * 2, crit: true })

    const normal = pick(simulate([A, B], () => 0.99).events, 'damage')[0]
    expect(normal).toMatchObject({ value: atk, crit: false })
  })

  it('普攻优先打血量最低的敌人(残血先死)', () => {
    const A = mk({ id: 'A1', team: 'A', atk: 100, def: 0, speed: 100, maxHp: 99999 })
    const low = mk({ id: 'B1', team: 'B', atk: 0, def: 0, speed: 1, maxHp: 150 })
    const high = mk({ id: 'B2', team: 'B', atk: 0, def: 0, speed: 1, maxHp: 99999 })

    const { events } = simulate([A, low, high], () => 0.99)
    const aAttacks = pick(events, 'attack')
      .filter((e) => e.source === 'A1')
      .map((e) => e.target)

    expect(aAttacks[0]).toBe('B1') // 起手集火残血
    expect(aAttacks[1]).toBe('B1') // 直到打死
    expect(events.some((e) => e.type === 'die' && e.unit === 'B1')).toBe(true)
  })

  it('能量满放大招,命中全体敌人(AoE)', () => {
    const A = mk({ id: 'A1', team: 'A', atk: 100, speed: 100, maxHp: 99999, skill: '青龙偃月' })
    const B1 = mk({ id: 'B1', team: 'B', atk: 0, speed: 1, maxHp: 99999 })
    const B2 = mk({ id: 'B2', team: 'B', atk: 0, speed: 1, maxHp: 99999 })

    const cast = pick(simulate([A, B1, B2], () => 0.99).events, 'cast').find((e) => e.source === 'A1')
    expect(cast?.skill).toBe('青龙偃月')
    expect(new Set(cast?.targets)).toEqual(new Set(['B1', 'B2']))
  })

  it('伤害有下限 1(防御高于攻击)', () => {
    const A = mk({ id: 'A1', team: 'A', atk: 10, def: 0, speed: 100, maxHp: 99999 })
    const B = mk({ id: 'B1', team: 'B', atk: 0, def: 9999, speed: 1, maxHp: 50 })
    const dmg = pick(simulate([A, B], () => 0.99).events, 'damage').find((e) => e.target === 'B1')
    expect(dmg?.value).toBe(1)
  })

  it('一方全灭则结束并判定胜者,末事件为 end', () => {
    const A = mk({ id: 'A1', team: 'A', atk: 99999, def: 0, speed: 100, maxHp: 1000 })
    const B = mk({ id: 'B1', team: 'B', atk: 0, def: 0, speed: 1, maxHp: 100 })
    const { events } = simulate([A, B], () => 0.99)
    expect(events[events.length - 1]).toEqual({ type: 'end', winner: 'A' })
  })
})
