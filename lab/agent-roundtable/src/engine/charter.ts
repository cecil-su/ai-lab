import type { Perspective, TopicMode } from "../store/topic.js";

// 内置视角模板库(design R6)。key 供 --perspectives 引用;未命中的字符串按自由文本处理。
export const PERSPECTIVE_TEMPLATES: Record<string, string> = {
  architect: "系统架构师:关注长期可维护性、模块边界、技术债与演进路径。",
  security: "安全工程师:关注攻击面、数据安全、权限边界、失败模式与滥用场景。",
  cost: "成本视角:关注资源开销、运维负担、token/算力成本与投入产出比。",
  ux: "用户体验视角:关注端到端体验、易用性、错误反馈与心智负担。",
  redteam: "红队:主动证伪当前方案,寻找它最可能崩溃的边界与被忽略的前提。",
  pragmatist: "务实工程师:关注最小可行方案、落地成本与交付风险。",
};

/** 视角解析:对象 = 自由文本;字符串命中模板取模板文,否则按自由文本原样返回 */
export function resolvePerspectiveText(p: Perspective): string {
  if (typeof p === "object") return p.custom;
  return PERSPECTIVE_TEMPLATES[p] ?? p;
}

const MODE_RULES: Record<TopicMode, string> = {
  roundtable: "自由圆桌:参与者按固定顺序轮流发言,平等讨论,无预设对抗立场。",
  debate:
    "对抗辩论:每位参与者代表自身视角的立场方,须为本方论点辩护并直接反驳与己相左的观点,不得附和或复述他方;" +
    "交锋满轮数上限(或提前收敛)后追加一轮裁决——由中立裁决人给出结论。",
};

export interface CharterParticipant {
  handle: string;
  providerBase: string;
  perspective: Perspective;
}

export interface CharterInput {
  title: string;
  mode: TopicMode;
  maxRounds: number;
  participants: CharterParticipant[];
  /** 注入的参考材料(已拼好的 markdown 段正文),缺省不注入 */
  contextMaterial?: string;
}

export function buildCharter(input: CharterInput): string {
  const roster = input.participants
    .map((p) => `- ${p.handle}(${p.providerBase}):${resolvePerspectiveText(p.perspective)}`)
    .join("\n");
  const sections = [
    `# 话题:${input.title}`,
    `## 议题\n${input.title}`,
    `## 模式\n${MODE_RULES[input.mode]}`,
    `## 参与者与视角\n${roster}`,
  ];
  if (input.mode === "debate") {
    const judge = `${input.participants[0]!.providerBase}-judge`;
    sections.push(
      `## 裁决安排\n交锋结束后由「${judge}」以中立裁决人身份、全新无记忆会话收尾,输出:结论 / 关键论据 / 分歧点 / 风险,写入 summary。`,
    );
  }
  if (input.contextMaterial && input.contextMaterial.trim()) {
    sections.push(input.contextMaterial.trim());
  }
  sections.push(
    [
      "## 停止条件",
      `- 轮数上限:${input.maxRounds} 轮${input.mode === "debate" ? "(之后追加裁决轮)" : ""}`,
      "- 收敛熔断:连续两轮全体立场不变,或全员跳过,自动收尾",
      "- 人类可随时 stop 结束话题",
    ].join("\n"),
  );
  return sections.join("\n\n") + "\n";
}
