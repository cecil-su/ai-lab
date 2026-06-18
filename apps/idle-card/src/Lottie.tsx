import { useEffect, useRef } from 'react'
import lottie from 'lottie-web'
import burst from './vfx/burst.json'

/**
 * 中档特效接入点:挂载即播一次 Lottie。
 * 想换别的特效,只改这里的 animationData(从 lottiefiles.com 下个 .json 即可),
 * 战斗逻辑和表现层调用都不用动。
 */
export function LottieBurst() {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!ref.current) return
    const anim = lottie.loadAnimation({
      container: ref.current,
      renderer: 'svg',
      loop: false,
      autoplay: true,
      animationData: burst,
    })
    return () => anim.destroy()
  }, [])
  return <div ref={ref} className="lottie-burst" />
}
