import type { Rarity, Team, UnitInit } from './battle/types'
import { growthMul } from './economy'

export interface Hero {
  id: string
  name: string
  rarity: Rarity
  emoji: string
  maxHp: number
  atk: number
  def: number
  speed: number
  skill: string
}

/** 玩家拥有的一张卡(带独立等级) */
export interface OwnedHero {
  heroId: string
  level: number
}

export function getHero(id: string): Hero | undefined {
  return POOL.find((h) => h.id === id)
}

// 卡池
export const POOL: Hero[] = [
  { id: 'guanyu', name: '关羽', rarity: 'SSR', emoji: '⚔️', maxHp: 1200, atk: 220, def: 60, speed: 95, skill: '青龙偃月' },
  { id: 'lvbu', name: '吕布', rarity: 'SSR', emoji: '🐎', maxHp: 1300, atk: 240, def: 70, speed: 110, skill: '方天画戟' },
  { id: 'zhangfei', name: '张飞', rarity: 'SR', emoji: '🛡️', maxHp: 1800, atk: 160, def: 100, speed: 70, skill: '燕人咆哮' },
  { id: 'diaochan', name: '貂蝉', rarity: 'SR', emoji: '🌸', maxHp: 900, atk: 180, def: 40, speed: 100, skill: '闭月之舞' },
  { id: 'zhaoyun', name: '赵云', rarity: 'SR', emoji: '🗡️', maxHp: 1100, atk: 190, def: 65, speed: 105, skill: '龙胆突刺' },
  { id: 'huangzhong', name: '黄忠', rarity: 'R', emoji: '🏹', maxHp: 1000, atk: 170, def: 50, speed: 85, skill: '百步穿杨' },
  { id: 'liubei', name: '刘备', rarity: 'R', emoji: '🤝', maxHp: 1300, atk: 130, def: 80, speed: 80, skill: '仁德之光' },
  { id: 'machao', name: '马超', rarity: 'R', emoji: '🐴', maxHp: 1050, atk: 185, def: 55, speed: 108, skill: '西凉铁骑' },
]

// 抽卡概率
const RATES: { rarity: Rarity; weight: number }[] = [
  { rarity: 'SSR', weight: 5 },
  { rarity: 'SR', weight: 20 },
  { rarity: 'R', weight: 75 },
]

export function rollHero(rng: () => number = Math.random): Hero {
  const r = rng() * 100
  let acc = 0
  let rarity: Rarity = 'R'
  for (const x of RATES) {
    acc += x.weight
    if (r < acc) { rarity = x.rarity; break }
  }
  const candidates = POOL.filter((h) => h.rarity === rarity)
  return candidates[Math.floor(rng() * candidates.length)]
}

// 把卡池英雄变成战斗单位(分配战斗位 id:A1/B1...,引擎和表现层靠首字母认队伍)
// level 按成长倍率放大三围(速度不变)
export function toUnit(hero: Hero, team: Team, idx: number, level = 1): UnitInit {
  const m = growthMul(level)
  return {
    ...hero,
    id: `${team}${idx + 1}`,
    team,
    maxHp: Math.round(hero.maxHp * m),
    atk: Math.round(hero.atk * m),
    def: Math.round(hero.def * m),
  }
}

// 关卡敌人:难度只由平滑缩放决定(统一基础模板 × 倍率),
// 轮换的武将仅提供名字/立绘/品质等"皮",不影响数值 → 曲线平滑可控
const ENEMY_BASE = { maxHp: 950, atk: 135, def: 45, speed: 95 }
const ENEMY_GROWTH = 0.1 // 每关 +10%
const ENEMY_FLAVOR = [POOL[1], POOL[3], POOL[4]] // 吕布 / 貂蝉 / 赵云(仅做皮)

export function enemyTeam(stage: number): UnitInit[] {
  const mult = 1 + ENEMY_GROWTH * (stage - 1)
  const count = stage < 4 ? 2 : 3
  return Array.from({ length: count }, (_, i) => {
    const flavor = ENEMY_FLAVOR[(stage + i) % ENEMY_FLAVOR.length]
    return {
      id: `B${i + 1}`,
      team: 'B' as Team,
      name: flavor.name,
      emoji: flavor.emoji,
      rarity: flavor.rarity,
      skill: flavor.skill,
      speed: ENEMY_BASE.speed,
      maxHp: Math.round(ENEMY_BASE.maxHp * mult),
      atk: Math.round(ENEMY_BASE.atk * mult),
      def: Math.round(ENEMY_BASE.def * mult),
    }
  })
}
