import { useEffect, useState } from 'react'
import { Battle } from './Battle'
import { POOL, rollHero, toUnit, enemyTeam, getHero, type Hero, type OwnedHero } from './heroes'
import type { Team, UnitInit } from './battle/types'
import { portraitUri, RARITY_LABEL } from './portrait'
import { idleGain, idleRate, upgradeCost, winReward } from './economy'
import { loadSave, writeSave, clearSave, sanitizeOwned } from './storage'

const GACHA_COST = 100
const TEAM_MAX = 3
const DEFAULT_OWNED: OwnedHero[] = [
  { heroId: 'guanyu', level: 1 },
  { heroId: 'zhangfei', level: 1 },
]

type Tab = 'gacha' | 'team' | 'stage'

function HeroCard({ hero, level, selected, badge, onSelect, upgrade }: {
  hero: Hero
  level?: number
  selected?: boolean
  badge?: string
  onSelect?: () => void
  upgrade?: { cost: number; canAfford: boolean; onUpgrade: () => void }
}) {
  return (
    <div
      className={`hero-card rarity-${hero.rarity}${selected ? ' selected' : ''}${onSelect ? ' clickable' : ''}`}
      onClick={onSelect}
    >
      <img className="hc-portrait" src={portraitUri(hero.name[0], hero.rarity)} alt={hero.name} />
      <span className={`hc-rarity r-${hero.rarity}`}>{RARITY_LABEL[hero.rarity]}</span>
      {level != null && <span className="hc-lv">Lv.{level}</span>}
      <span className="hc-name">{hero.name}</span>
      <span className="hc-skill">{hero.skill}</span>
      {badge && <span className="hc-badge">{badge}</span>}
      {upgrade && (
        <button
          className="hc-up"
          onClick={(e) => { e.stopPropagation(); upgrade.onUpgrade() }}
          disabled={!upgrade.canAfford}
        >
          升级 {upgrade.cost}💎
        </button>
      )}
    </div>
  )
}

export default function App() {
  const [save] = useState(loadSave) // 仅读一次
  const [tab, setTab] = useState<Tab>('gacha')
  const [owned, setOwned] = useState<OwnedHero[]>(() => (save ? sanitizeOwned(save.owned) : DEFAULT_OWNED))
  const [teamIdx, setTeamIdx] = useState<number[]>(() => save?.teamIdx ?? [0, 1])
  const [diamonds, setDiamonds] = useState(() => save?.diamonds ?? 600)
  const [stage, setStage] = useState(() => save?.stage ?? 1)
  const [lastTs, setLastTs] = useState(() => save?.lastTs ?? Date.now())
  const [now, setNow] = useState(() => Date.now())
  const [revealed, setRevealed] = useState<Hero | null>(null)
  const [inBattle, setInBattle] = useState(false)
  const [battleNo, setBattleNo] = useState(0)
  const [msg, setMsg] = useState('')

  // 存档:任一关键状态变化即写入
  useEffect(() => {
    writeSave({ owned, teamIdx, diamonds, stage, lastTs })
  }, [owned, teamIdx, diamonds, stage, lastTs])

  // 挂机:每秒刷新当前时间,据此结算待领钻石
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])
  const pending = idleGain(now - lastTs, stage)

  const collectIdle = () => {
    if (pending <= 0) return
    setDiamonds((d) => d + pending)
    setLastTs(Date.now())
  }

  const resetSave = () => {
    clearSave()
    setOwned(DEFAULT_OWNED)
    setTeamIdx([0, 1])
    setDiamonds(600)
    setStage(1)
    setLastTs(Date.now())
    setRevealed(null)
    setMsg('存档已重置')
  }

  const draw = () => {
    if (diamonds < GACHA_COST) { setMsg('💎 不足'); return }
    const hero = rollHero()
    setDiamonds((d) => d - GACHA_COST)
    setOwned((o) => [...o, { heroId: hero.id, level: 1 }])
    setRevealed(hero)
  }

  const toggleTeam = (idx: number) => {
    setTeamIdx((t) => {
      if (t.includes(idx)) return t.filter((x) => x !== idx)
      if (t.length >= TEAM_MAX) return t
      return [...t, idx]
    })
  }

  const upgrade = (idx: number) => {
    const cost = upgradeCost(owned[idx].level)
    if (diamonds < cost) { setMsg('💎 不足,升不动'); return }
    setDiamonds((d) => d - cost)
    setOwned((o) => o.map((x, i) => (i === idx ? { ...x, level: x.level + 1 } : x)))
  }

  const startBattle = () => {
    if (!teamIdx.length) { setMsg('请先去「编队」上阵武将'); return }
    setMsg('')
    setBattleNo((n) => n + 1)
    setInBattle(true)
  }

  const onFinish = (winner: Team) => {
    if (winner === 'A') {
      const reward = winReward(stage)
      setMsg(`第 ${stage} 关通关!+${reward}💎`)
      setStage((s) => s + 1)
      setDiamonds((d) => d + reward)
    } else {
      setMsg(`第 ${stage} 关失败,去升级或抽卡再来`)
    }
    setInBattle(false)
  }

  if (inBattle) {
    const playerUnits = teamIdx.map((oi, i) => {
      const oh = owned[oi]
      return toUnit(getHero(oh.heroId)!, 'A', i, oh.level)
    })
    const units: UnitInit[] = [...playerUnits, ...enemyTeam(stage)]
    return <Battle key={battleNo} units={units} onFinish={onFinish} />
  }

  return (
    <div className="app">
      <h1>放置卡牌 · MVP</h1>

      <div className="topbar">
        <span>💎 {diamonds}</span>
        <span>关卡 {stage}</span>
        <span>队伍 {teamIdx.length}/{TEAM_MAX}</span>
      </div>

      <div className="idle-bar">
        <span>挂机收益 <b>+{pending}💎</b> <small>({Math.round(idleRate(stage) * 60)} 💎/分 · 第{stage}关)</small></span>
        <button className="idle-btn" onClick={collectIdle} disabled={pending <= 0}>领取</button>
      </div>

      <div className="tabs">
        {(['gacha', 'team', 'stage'] as Tab[]).map((t) => (
          <button key={t} className={`tab${tab === t ? ' active' : ''}`} onClick={() => { setTab(t); setMsg('') }}>
            {t === 'gacha' ? '抽卡' : t === 'team' ? '编队/养成' : '推图'}
          </button>
        ))}
      </div>

      {msg && <div className="msg">{msg}</div>}

      {tab === 'gacha' && (
        <div className="panel">
          <button className="fight-btn" onClick={draw} disabled={diamonds < GACHA_COST}>
            抽卡 ({GACHA_COST}💎)
          </button>
          {revealed && (
            <div className="reveal" key={owned.length}>
              <HeroCard hero={revealed} />
              <div className="reveal-text">获得 {RARITY_LABEL[revealed.rarity]} · {revealed.name}!</div>
            </div>
          )}
          <p className="hint">概率:SSR 5% / SR 20% / R 75% · 已拥有 {owned.length} 张</p>
        </div>
      )}

      {tab === 'team' && (
        <div className="panel">
          <p className="hint">点击卡片上阵(最多 {TEAM_MAX} 个),点「升级」耗钻提升属性</p>
          <div className="card-grid">
            {owned.map((oh, i) => {
              const base = getHero(oh.heroId)
              if (!base) return null
              const cost = upgradeCost(oh.level)
              return (
                <HeroCard
                  key={i}
                  hero={base}
                  level={oh.level}
                  selected={teamIdx.includes(i)}
                  badge={teamIdx.includes(i) ? String(teamIdx.indexOf(i) + 1) : undefined}
                  onSelect={() => toggleTeam(i)}
                  upgrade={{ cost, canAfford: diamonds >= cost, onUpgrade: () => upgrade(i) }}
                />
              )
            })}
          </div>
        </div>
      )}

      {tab === 'stage' && (
        <div className="panel">
          <div className="stage-info">第 {stage} 关</div>
          <div className="enemy-preview">
            {enemyTeam(stage).map((e) => (
              <img key={e.id} className="enemy-mini" src={portraitUri(e.name[0], e.rarity)} alt={e.name} />
            ))}
          </div>
          <button className="fight-btn" onClick={startBattle} disabled={!teamIdx.length}>⚔ 挑战</button>
        </div>
      )}

      <button className="reset-link" onClick={resetSave}>重置存档</button>
    </div>
  )
}
