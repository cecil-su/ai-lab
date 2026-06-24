# wechat-use (lab)

自建复刻 leeguooooo/wechat-use 的 macOS 微信本地 API。**Phase 0-1 骨架**。
设计 + 路线图:`docs/designs/2026-06-24-wechat-use-replicate.md`。

## 现状

- ✅ **Phase 0** — `doctor` 环境体检、`dbs` 发现库文件、`key` 管理。跨平台可跑(非 Mac 上检查项仅供参考)。
- ◐ **Phase 1** — SQLCipher 读层:`tables` / `schema` / `query`(全可用,需 `sqlcipher` CLI + key)、`history` / `export`(md/json)。⚠️ 表名/字段按上游文档假设,**待 Mac 上用真库核**;content 解码已含 zstd + 群前缀 + hex(BLOB)兜底。
- ⬜ **Phase 2** — 取 key 未实现:`keyextract.py` 是诚实骨架(fingerprint→OFFSETS 查表 + lldb TODO)。先手动喂 key。

**22 个单元测试**(`tests/`)锁住纯逻辑:`python -m unittest discover -s tests -t .`。
覆盖 content 解码(zstd/hex/群前缀/边界)、key 校验往返、export 渲染。不依赖 Mac/真库。

## 用法

```bash
python -m wechat_use doctor            # 环境体检
python -m wechat_use dbs               # 发现 WeChat 消息库

# 拿到 key 后(Phase 2 之前先手动 lldb 抓一次):
python -m wechat_use key set <64-hex>

# Mac 上第一步:先摸清真实 schema,再回头修 messages.py 的假设
python -m wechat_use tables  --db <db路径>
python -m wechat_use schema  --db <db路径> <表名>
python -m wechat_use query   --db <db路径> "SELECT ..."

# 高层(schema 核对后才可靠)
python -m wechat_use history --db <db路径> <chat-wxid> -n 50
```

## 待 Mac 上确认 / 修正(已在代码里标 ⚠️)

1. `paths.py` `_DB_GLOBS` — 容器内真实库路径,跑 `dbs` 后收紧。
2. `messages.py` — 消息表名 `Msg_<md5(wxid)>` 的 md5 输入编码、`content`/`create_time` 列名、zstd 框架、群前缀格式;跑 `tables`/`schema` 核对后改。
3. content 若是 BLOB,`.mode json` 可能返回非预期编码 → 届时改用 `SELECT hex(content)` 取字节再解。

## 依赖

- `sqlcipher` CLI(`brew install sqlcipher`)。
- 可选 `zstandard`(解压消息 content):`pip install -e '.[zstd]'`。
