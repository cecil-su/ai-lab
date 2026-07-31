import { useCallback, useState } from "react";
import { Box, Text, useApp, useInput, useStdin } from "ink";
import { appendInbox } from "../store/inbox.js";
import { computeStatusBar, parseInput, renderRows } from "./render.js";
import { useRoundtable } from "./useRoundtable.js";

export interface AppProps {
  dir: string;
  humanName: string;
  /** 方案①:仅持有 attach 写锁的进程可插话/停止;其余进程只读跟随 */
  canWrite: boolean;
}

export function App({ dir, humanName, canWrite }: AppProps): React.JSX.Element {
  const { events, pending, topic, lockAlive, refresh } = useRoundtable(dir);
  const { exit } = useApp();
  const { isRawModeSupported } = useStdin();
  const [buffer, setBuffer] = useState("");
  const [notice, setNotice] = useState("");
  // 从尾部回退的行数:0 = 跟随尾部;PgUp/PgDn 翻页回看历史,任何输入自动回底
  const [scrollBack, setScrollBack] = useState(0);

  const submit = useCallback(() => {
    const action = parseInput(buffer);
    setBuffer("");
    setScrollBack(0);
    if (action.type === "noop") return;
    if (action.type === "quit") {
      exit();
      return;
    }
    if (!canWrite) {
      setNotice("只读模式:已有 attach 持有写入权,无法插话/停止");
      return;
    }
    if (action.type === "stop") {
      appendInbox(dir, { kind: "stop", from: humanName });
      setNotice(":stop 已写入 inbox,runner 将在安全边界收尾");
    } else {
      appendInbox(dir, { kind: "say", from: humanName, body: action.body });
      setNotice("");
    }
    refresh();
  }, [buffer, canWrite, dir, humanName, exit, refresh]);

  useInput(
    (input, key) => {
      if (key.return) {
        submit();
        return;
      }
      // 翻页回看历史;任何普通输入/退格自动回到底部
      if (key.pageUp) {
        setScrollBack((s) => Math.min(s + maxRows, Math.max(0, rows.length - maxRows)));
        return;
      }
      if (key.pageDown) {
        setScrollBack((s) => Math.max(0, s - maxRows));
        return;
      }
      setScrollBack(0);
      if (key.backspace || key.delete) {
        setBuffer((b) => b.slice(0, -1));
        return;
      }
      if (key.escape || (key.ctrl && input === "c")) {
        exit();
        return;
      }
      // q 退出仅在输入框为空时生效,否则 q 作为普通字符输入
      if (buffer === "" && (input === "q" || input === "Q")) {
        exit();
        return;
      }
      if (input && !key.ctrl && !key.meta) setBuffer((b) => b + input);
    },
    { isActive: isRawModeSupported === true },
  );

  const rows = renderRows(events, pending);
  const maxRows = Math.max(5, (process.stdout.rows ?? 24) - 5);
  // tail=0 跟随尾部;回看时取 [尾部-tail-maxRows, 尾部-tail) 窗口,并夹紧到历史长度
  const tail = Math.min(scrollBack, Math.max(0, rows.length - maxRows));
  const visible = tail === 0 ? rows.slice(-maxRows) : rows.slice(-(tail + maxRows), rows.length - tail);

  const status = computeStatusBar(topic, lockAlive);

  return (
    <Box flexDirection="column">
      <Box flexDirection="column">
        {visible.map((r) => (
          <Text key={r.key} color={r.color} bold={r.bold} dimColor={r.dim}>
            {r.text}
          </Text>
        ))}
      </Box>
      <Box>
        <Text backgroundColor="blue" color="white">
          {` ${status.title} | ${status.mode} | 轮次 ${status.round} | runner ${status.runner} | tokens ${status.tokens} `}
        </Text>
      </Box>
      <Box>
        <Text color="green">{canWrite ? "> " : "[只读] "}</Text>
        <Text>{buffer}</Text>
      </Box>
      {notice ? <Text color="yellow">{notice}</Text> : null}
      {tail > 0 ? <Text dimColor>↑ 回看中(PgUp/PgDn 翻页,输入回到底部)</Text> : null}
      {isRawModeSupported === true ? (
        <Text dimColor>回车发送 | :stop 结束讨论 | q/Esc 退出视图(不影响 runner)</Text>
      ) : (
        <Text dimColor>(当前终端无 TTY raw mode:只读跟随,键盘输入不可用)</Text>
      )}
    </Box>
  );
}
