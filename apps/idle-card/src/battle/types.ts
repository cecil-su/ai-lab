export type Team = 'A' | 'B'

export type Rarity = 'R' | 'SR' | 'SSR'

export interface UnitInit {
  id: string
  name: string
  emoji: string
  team: Team
  rarity: Rarity
  maxHp: number
  atk: number
  def: number
  speed: number
  skill: string
}

/**
 * 战斗事件:内核只产出这串事件,表现层照着逐个播放。
 * 这是"逻辑与表现解耦"的关键——数值可单测、战斗可回放、改特效不动逻辑。
 */
export type BattleEvent =
  | { type: 'attack'; source: string; target: string }
  | { type: 'cast'; source: string; skill: string; targets: string[] }
  | { type: 'damage'; target: string; value: number; crit: boolean; hpAfter: number }
  | { type: 'die'; unit: string }
  | { type: 'end'; winner: Team }

export interface BattleResult {
  units: UnitInit[]
  events: BattleEvent[]
}
