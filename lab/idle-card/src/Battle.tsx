import { useEffect, useRef, useState } from 'react'
import { simulate } from './battle/engine'
import type { BattleEvent, Team, UnitInit } from './battle/types'
import { portraitUri } from './portrait'
import { LottieBurst } from './Lottie'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

interface FloatText { key: number; unitId: string; value: number; crit: boolean }
interface VfxItem { key: number; unitId: string }

export function Battle({ units, onFinish }: { units: UnitInit[]; onFinish: (winner: Team) => void }) {
  const nameOf = (id: string) => units.find((u) => u.id === id)?.name ?? id

  const describe = (ev: BattleEvent): string => {
    switch (ev.type) {
      case 'attack': return `${nameOf(ev.source)} 普攻 → ${nameOf(ev.target)}`
      case 'cast': return `${nameOf(ev.source)} 释放【${ev.skill}】→ ${ev.targets.map(nameOf).join('、')}`
      case 'damage': return `    ${nameOf(ev.target)} -${ev.value}${ev.crit ? ' 暴击!' : ''}`
      case 'die': return `    💀 ${nameOf(ev.unit)} 倒下`
      case 'end': return `⚑ 战斗结束 — ${ev.winner === 'A' ? '我方' : '敌方'}胜利`
    }
  }

  const [hp, setHp] = useState<Record<string, number>>(() => Object.fromEntries(units.map((u) => [u.id, u.maxHp])))
  const [dead, setDead] = useState<Record<string, boolean>>({})
  const [anim, setAnim] = useState<Record<string, string>>({})
  const [floats, setFloats] = useState<FloatText[]>([])
  const [vfx, setVfx] = useState<VfxItem[]>([])
  const [shake, setShake] = useState(false)
  const [winner, setWinner] = useState<Team | null>(null)
  const [log, setLog] = useState<string[]>([])
  const seq = useRef(0)
  const started = useRef(false)

  const setAnimFor = (id: string, cls: string) => setAnim((a) => ({ ...a, [id]: cls }))
  const clearAnim = (id: string) => setAnim((a) => ({ ...a, [id]: '' }))

  const spawnFloat = (unitId: string, value: number, crit: boolean) => {
    const key = ++seq.current
    setFloats((f) => [...f, { key, unitId, value, crit }])
    setTimeout(() => setFloats((f) => f.filter((x) => x.key !== key)), 800)
  }
  const spawnVfx = (unitId: string) => {
    const key = ++seq.current
    setVfx((v) => [...v, { key, unitId }])
    setTimeout(() => setVfx((v) => v.filter((x) => x.key !== key)), 720)
  }
  const doShake = () => { setShake(true); setTimeout(() => setShake(false), 360) }

  async function play(ev: BattleEvent) {
    setLog((l) => [...l.slice(-40), describe(ev)])
    switch (ev.type) {
      case 'attack':
        setAnimFor(ev.source, ev.source[0] === 'A' ? 'dash-r' : 'dash-l')
        await sleep(160)
        clearAnim(ev.source)
        break
      case 'cast':
        setAnimFor(ev.source, 'cast')
        await sleep(260)
        for (const t of ev.targets) spawnVfx(t)
        doShake()
        await sleep(140)
        clearAnim(ev.source)
        break
      case 'damage':
        setHp((h) => ({ ...h, [ev.target]: ev.hpAfter }))
        spawnFloat(ev.target, ev.value, ev.crit)
        setAnimFor(ev.target, 'hit')
        if (ev.crit) doShake()
        await sleep(ev.crit ? 420 : 220) // 顿帧:暴击停更久
        clearAnim(ev.target)
        break
      case 'die':
        setDead((d) => ({ ...d, [ev.unit]: true }))
        await sleep(180)
        break
      case 'end':
        setWinner(ev.winner)
        break
    }
  }

  useEffect(() => {
    if (started.current) return // StrictMode 防重入
    started.current = true
    ;(async () => {
      const result = simulate(units)
      for (const ev of result.events) await play(ev)
    })()
  }, [])

  const renderTeam = (team: Team) => (
    <div className={`team team-${team}`}>
      {units.filter((u) => u.team === team).map((u) => {
        const cur = hp[u.id]
        const pct = Math.max(0, (cur / u.maxHp) * 100)
        return (
          <div key={u.id} className={`unit${dead[u.id] ? ' dead' : ''}`}>
            <div className="floats">
              {floats.filter((f) => f.unitId === u.id).map((f) => (
                <span key={f.key} className={`float${f.crit ? ' crit' : ''}`}>-{f.value}</span>
              ))}
            </div>
            <div className={`avatar rarity-${u.rarity} ${anim[u.id] ?? ''}`}>
              <img className="portrait" src={portraitUri(u.name[0], u.rarity)} alt={u.name} />
              {vfx.filter((v) => v.unitId === u.id).map((v) => (
                <span key={v.key} className="vfx">
                  <span className="vfx-slash" />
                  <LottieBurst />
                </span>
              ))}
            </div>
            <div className="name">{u.name}</div>
            <div className="hpbar"><span className="hpfill" style={{ width: `${pct}%` }} /></div>
            <div className="hptext">{Math.max(0, cur)} / {u.maxHp}</div>
          </div>
        )
      })}
    </div>
  )

  return (
    <div className="app">
      <h1>战斗</h1>
      <div className={`arena${shake ? ' shaking' : ''}`}>
        {renderTeam('A')}
        <div className="vs">VS</div>
        {renderTeam('B')}
        {winner && (
          <div className="result">
            <div>{winner === 'A' ? '胜利!' : '失败'}</div>
            <button className="back-btn" onClick={() => onFinish(winner)}>返回</button>
          </div>
        )}
      </div>
      <div className="log">
        {log.map((line, i) => <div key={i} className="log-line">{line}</div>)}
      </div>
    </div>
  )
}
