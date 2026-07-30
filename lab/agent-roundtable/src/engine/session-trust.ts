import { REASONIX_LAST_SESSION } from "../adapters/reasonix.js";

// 降级/不可信 sessionRef 哨兵集合:这些无法唯一定位「该参与者自己的线程」,不得走增量(F4① / #4)。
const DEGRADED_REFS = new Set<string>([REASONIX_LAST_SESSION]);

/** sessionRef 是否可信到能安全走增量:非空且非降级哨兵。普通轮与 finalize 共用同一闸门(#5)。 */
export function isTrustedRef(ref: string | null | undefined): boolean {
  return !!ref && !DEGRADED_REFS.has(ref);
}
