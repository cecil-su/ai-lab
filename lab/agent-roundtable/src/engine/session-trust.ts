import { LEGACY_DEGRADED_SENTINEL, makeDegraded, makeVerified, type SessionRef } from "../adapters/types.js";

// 会话信任「策略」层:构造子(make*)与类型同处 adapters/types(下游),这里只放判定与迁移(ADR 0032)。

/** 是否可信到能安全走增量:verified 且 resumable。普通轮与 finalize 共用同一闸门(#5)。 */
export function canResume(ref: SessionRef | null | undefined): boolean {
  return !!ref && ref.trust === "verified" && ref.resumable;
}

/** 迁移旧 topic.json 的裸字符串 sessionRef:@last → degraded;其余(仅成功时才落盘)→ verified。 */
export function fromLegacy(provider: string, raw: string): SessionRef {
  return raw === LEGACY_DEGRADED_SENTINEL ? makeDegraded(provider, raw) : makeVerified(provider, raw);
}
