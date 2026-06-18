import type { BattleEvent, BattleResult, Team, UnitInit } from './types'

interface Combatant extends UnitInit {
  hp: number
  energy: number
}

const CRIT_RATE = 0.25
const CRIT_MULTIPLIER = 2
const ENERGY_PER_TURN = 34 // 0 -> 100 约 3 回合放一次大招
const SKILL_MULTIPLIER = 1.8

/**
 * 纯函数:一次算完整场战斗,产出事件流。
 * 不依赖 React、不碰画面。可单测、可移植(以后搬去微信小游戏内核不变)。
 */
export function simulate(initial: UnitInit[], rng: () => number = Math.random): BattleResult {
  const units: Combatant[] = initial.map((u) => ({ ...u, hp: u.maxHp, energy: 0 }))
  const events: BattleEvent[] = []
  const aliveOf = (team: Team) => units.filter((u) => u.team === team && u.hp > 0)

  const hit = (tgt: Combatant, raw: number, crit: boolean) => {
    const dmg = Math.max(1, raw - tgt.def)
    tgt.hp = Math.max(0, tgt.hp - dmg)
    events.push({ type: 'damage', target: tgt.id, value: dmg, crit, hpAfter: tgt.hp })
    if (tgt.hp <= 0) events.push({ type: 'die', unit: tgt.id })
  }

  let guard = 0
  while (aliveOf('A').length && aliveOf('B').length && guard++ < 300) {
    // 每回合按速度排序行动
    const order = units.filter((u) => u.hp > 0).sort((a, b) => b.speed - a.speed)
    for (const u of order) {
      if (u.hp <= 0) continue
      const foes = aliveOf(u.team === 'A' ? 'B' : 'A')
      if (!foes.length) break

      u.energy += ENERGY_PER_TURN
      if (u.energy >= 100) {
        // 大招:全体敌人(AoE)
        u.energy = 0
        events.push({ type: 'cast', source: u.id, skill: u.skill, targets: foes.map((f) => f.id) })
        for (const f of foes) hit(f, Math.round(u.atk * SKILL_MULTIPLIER), false)
      } else {
        // 普攻:打血量最低的敌人
        const target = foes.reduce((a, b) => (a.hp <= b.hp ? a : b))
        events.push({ type: 'attack', source: u.id, target: target.id })
        const crit = rng() < CRIT_RATE
        hit(target, Math.round(u.atk * (crit ? CRIT_MULTIPLIER : 1)), crit)
      }
    }
  }

  events.push({ type: 'end', winner: aliveOf('A').length ? 'A' : 'B' })
  return { units: initial, events }
}
