import { describe, it, expect } from 'vitest'
import { buildPlayer, winRate, wallStage } from './sim'
import type { OwnedHero } from './heroes'

const TEAMS: { name: string; team: OwnedHero[] }[] = [
  { name: '起手 2 人 Lv1 (关羽/张飞)', team: [{ heroId: 'guanyu', level: 1 }, { heroId: 'zhangfei', level: 1 }] },
  { name: '满编 3 人 Lv1 (+赵云)', team: [{ heroId: 'guanyu', level: 1 }, { heroId: 'zhangfei', level: 1 }, { heroId: 'zhaoyun', level: 1 }] },
  { name: '满编 3 人 Lv5', team: [{ heroId: 'guanyu', level: 5 }, { heroId: 'zhangfei', level: 5 }, { heroId: 'zhaoyun', level: 5 }] },
  { name: '满编 3 人 Lv10', team: [{ heroId: 'guanyu', level: 10 }, { heroId: 'zhangfei', level: 10 }, { heroId: 'zhaoyun', level: 10 }] },
]

describe('数值平衡报告', () => {
  it('打印难度曲线 + 各阵容的墙', () => {
    const stages = Array.from({ length: 15 }, (_, i) => i + 1)
    let out = '\n关卡胜率(%):\n      '
    out += stages.map((s) => `S${s}`.padStart(5)).join('')
    out += '\n'
    for (const { name, team } of TEAMS) {
      const player = buildPlayer(team)
      const row = stages.map((s) => `${Math.round(winRate(player, s, 120) * 100)}`.padStart(5)).join('')
      out += name.padEnd(22) + row + '\n'
    }
    out += '\n墙(胜率首次 <50% 的关):\n'
    for (const { name, team } of TEAMS) {
      out += `  ${name.padEnd(22)} → 第 ${wallStage(buildPlayer(team))} 关\n`
    }
    console.log(out)

    // 基本健全性:起手队能过第 1 关
    expect(winRate(buildPlayer(TEAMS[0].team), 1, 200)).toBeGreaterThan(0.5)
  })

  it('平衡不变式:养成/扩编推墙更远,起手会在合理范围卡墙', () => {
    const wall = (t: OwnedHero[]) => wallStage(buildPlayer(t))
    const three = (lv: number): OwnedHero[] => [
      { heroId: 'guanyu', level: lv },
      { heroId: 'zhangfei', level: lv },
      { heroId: 'zhaoyun', level: lv },
    ]
    // 养成越深,墙越远(单调)
    expect(wall(three(5))).toBeGreaterThan(wall(three(1)))
    expect(wall(three(10))).toBeGreaterThan(wall(three(5)))

    // 起手 2 人:稳过 S1,但 8 关内必撞墙(逼玩家凑人/升级)
    const starter = buildPlayer([{ heroId: 'guanyu', level: 1 }, { heroId: 'zhangfei', level: 1 }])
    expect(winRate(starter, 1, 200)).toBeGreaterThan(0.8)
    expect(wallStage(starter)).toBeLessThanOrEqual(8)
  })
})
