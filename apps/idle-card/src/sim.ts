import { simulate } from './battle/engine'
import { toUnit, enemyTeam, getHero, type OwnedHero } from './heroes'
import type { UnitInit } from './battle/types'

/** 把"拥有的卡(带等级)"展开成战斗用的玩家单位 */
export function buildPlayer(team: OwnedHero[]): UnitInit[] {
  return team.map((oh, i) => toUnit(getHero(oh.heroId)!, 'A', i, oh.level))
}

/** 跑 runs 次战斗,返回玩家胜率(用真实引擎,crit 随机会被平均掉) */
export function winRate(player: UnitInit[], stage: number, runs = 200): number {
  let wins = 0
  for (let i = 0; i < runs; i++) {
    const { events } = simulate([...player, ...enemyTeam(stage)])
    const end = events[events.length - 1]
    if (end.type === 'end' && end.winner === 'A') wins++
  }
  return wins / runs
}

/** 找到玩家从第 1 关连推、第一个胜率跌破阈值的关卡(墙) */
export function wallStage(player: UnitInit[], threshold = 0.5, maxStage = 40): number {
  for (let s = 1; s <= maxStage; s++) {
    if (winRate(player, s) < threshold) return s
  }
  return maxStage + 1
}
