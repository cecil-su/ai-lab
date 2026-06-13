# MasterDnsVPN 原理分析与部署使用文档

> 本地仓库：`vendor/MasterDnsVPN/`（已 `git clone` 拉取）
> 上游：https://github.com/masterking32/MasterDnsVPN
> 许可证：MIT　语言：Go（`>= 1.24`）　整理日期：2026-06-13

---

## 0. 一句话定位

MasterDnsVPN 是一个**把 TCP 流量封装进 DNS 查询/响应里穿透网络封锁**的隧道工具，
定位与 DNSTT / SlipStream 类似，但用了**自研轻量协议 + ARQ 重传 + 多解析器负载均衡 + 包复制**，
目标是在「连国际带宽都被物理切断、只剩本地受控 DNS」的极端环境下仍能联网。

> ⚠️ **免责声明**：上游明确声明这是科研/教育项目，按 "AS-IS" 提供，不承担任何后果。
> 用它绕过当地法律可能涉及民事/刑事责任。请在授权和合法的前提下使用（如自有网络测试、研究）。

---

## 1. 工作原理

### 1.1 为什么 DNS 能穿透封锁

即使一个网络封掉了所有 VPN、只允许你用它指定的本地 DNS 服务器，DNS 查询本身仍然必须放行——
否则整个网络无法解析域名。MasterDnsVPN 正是利用这一点：

- 客户端把要发送的数据**加密 + 切成小片**，编码进 DNS 查询的子域名标签里
  （例如 `<编码数据>.v.example.com`）。
- 这些查询发给**公共/本地 DNS 解析器**，解析器按 DNS 委派规则把它们转发到你自己服务器的权威 NS。
- 你的服务器（伪装成 `v.example.com` 的权威 DNS）解码出真实数据，代理连到目标网站，
  再把响应数据塞进 **DNS 应答记录**里逐片回传。
- 对中间的防火墙来说，这一切看起来只是「普通的 DNS 请求和应答」，于是被放行。

### 1.2 关键域名委派（这是整套方案的前提）

你需要一个域名，配置两条记录，把一个子域「委派」给你的服务器当权威 DNS：

| 记录 | 名称 | 值 | 作用 |
| :-- | :-- | :-- | :-- |
| `A` | `ns` | 你的服务器 IPv4 | 服务器地址 |
| `NS` | `v`（隧道子域） | `ns.example.com` | 把 `v.example.com` 委派给上面的 A 记录 |

结果：任何对 `*.v.example.com` 的查询，最终都会被送到你的服务器。
> Cloudflare 用户：`ns` 这条 A 记录必须设为 **DNS only（灰色云朵，不能开橙色代理）**。
> 域名越短，每个 DNS 请求里能装的真实数据越多（吞吐越高）。

### 1.3 端到端数据流

```
App ──SOCKS5──► 客户端 ──加密/ARQ/选解析器──► 公共DNS解析器 ──委派──► 你的服务器(权威NS)
                                                                          │
 App ◄──有序数据── 客户端 ◄──DNS应答── 解析器 ◄──DNS应答── 服务器 ──直连/外部SOCKS5──► 目标网站
```

1. 应用把流量交给客户端本地的 **SOCKS5 / TCP 代理**（默认 `127.0.0.1:18000`）。
2. 客户端建立 **Session（总连接）/ Stream（逻辑子连接）**，加密、过 ARQ、选解析器、按需复制包。
3. 通过多个解析器并行发送 DNS 查询（带负载均衡和复制）。
4. 服务器校验 cookie/校验和、查会话、解码、过 ARQ，**直连目标**或**经外部 SOCKS5**出站。
5. 返回数据被装进 DNS 应答逐片回传；客户端重排序、消费 ACK、交还给应用。

### 1.4 核心机制（决定它为什么稳）

| 机制 | 作用 |
| :-- | :-- |
| **自研 ARQ** | 排序、ACK、重传、超时——DNS 本身不可靠，ARQ 负责补回丢失的片段 |
| **多解析器 + 负载均衡** | 8 种均衡策略（轮询/随机/最低丢包/最低延迟/混合评分等），不依赖单一可封锁路径 |
| **包复制（Duplication）** | 同一个包发多份走不同解析器，弱链路上提高送达概率（可配置/可关） |
| **解析器健康检查 + 自动禁用/恢复** | 超时多的解析器自动下线，后台再探测健康后自动恢复 |
| **MTU 探测与同步** | 自动测出每条路径可用的 DNS 载荷大小，统一选一个，减少分片 |
| **Packed Control Blocks** | 把多个 ACK/控制小包打包成一块，降低控制开销 |
| **可选压缩** | ZSTD/LZ4/ZLIB，小 MTU 下减少请求数 |
| **灵活加密** | None/XOR/ChaCha20/AES-128/192/256-GCM，在速度和安全间权衡 |
| **客户端本地 DNS + 缓存** | 可选，减少 DNS 劫持、降低延迟 |

协议头开销仅 ~5–7 字节（比 DNSTT 低约 88%），这是它吞吐高、对小 MTU 容忍好的关键。

### 1.5 代码结构速览（`vendor/MasterDnsVPN/`）

```
cmd/server, cmd/client    程序入口（两个独立二进制）
internal/arq              ARQ 重传/排序
internal/client           客户端运行时：均衡器、调度、会话、SOCKS、MTU、ping
internal/udpserver        服务端 UDP 监听
internal/vpnproto         自研隧道协议编解码
internal/dnsparser        DNS 报文解析
internal/dnscache         DNS 缓存
internal/security         加密
internal/compression      压缩
internal/basecodec        base32/36/64 标签编码
docker/                   Dockerfile + compose + 入口脚本
server_linux_install.sh   Linux 服务端一键安装脚本
*.toml.simple             完整示例配置
```

---

## 2. 部署：按场景选择

四个文件贯穿始终：

| 文件 | 位置 | 作用 |
| :-- | :-- | :-- |
| `server_config.toml` | 服务端 | 服务端配置 |
| `encrypt_key.txt` | 服务端 | 共享加密密钥（首次启动自动生成，**复制给客户端用**） |
| `client_config.toml` | 客户端 | 客户端配置 |
| `client_resolvers.txt` | 客户端 | 可用解析器列表 |

**客户端 4 项必对齐**：`ENCRYPTION_KEY`=服务器密钥、`DOMAINS`=服务器域名、
`client_resolvers.txt` 有可用解析器、常规用 `PROTOCOL_TYPE="SOCKS5"`。
**服务端 4 项关键**：`DOMAIN`=委派子域、`DATA_ENCRYPTION_METHOD` 与客户端一致、
`ENCRYPTION_KEY_FILE` 路径、直连出站则 `USE_EXTERNAL_SOCKS5=false`。

> 加密方式编号（两端必须一致）：`0=None 1=XOR 2=ChaCha20 3=AES-128-GCM 4=AES-192-GCM 5=AES-256-GCM`。
> XOR 轻量但弱，AEAD 安全但开销大。

---

### 场景 A：Linux VPS 一键脚本（最简单，推荐新手）

**前提**：已按 1.2 节配好 `A` + `NS` 记录，并等待 DNS 传播（几分钟~最多 48 小时）。

服务端（root）：

```bash
bash <(curl -Ls https://raw.githubusercontent.com/masterking32/MasterDnsVPN/main/server_linux_install.sh)
```

脚本会：询问你的隧道域名（填 `v.example.com`，必须和 NS 记录一致）→ 自动安装/配置/启动 →
在终端和 `encrypt_key.txt` 里输出**加密密钥**（务必保存，客户端要用）。

安装后检查：

```bash
# 验证委派是否生效
dig v.example.com NS
dig @ns.example.com v.example.com A

# 放行 UDP 53
sudo ufw allow 53/udp && sudo ufw reload
# 或 firewalld
sudo firewall-cmd --add-port=53/udp --permanent && sudo firewall-cmd --reload
```

> 若提示端口 53 被占用，见 §4「端口 53 占用」。

客户端：从 [Releases](https://github.com/masterking32/MasterDnsVPN/releases/latest) 下载对应平台包，
解压，编辑 `client_config.toml` 填入域名、密钥、解析器，运行二进制，
浏览器/应用设置 SOCKS5 代理 `127.0.0.1:18000`。

---

### 场景 B：Docker 部署服务端（推荐生产 / 不想改宿主机）

```bash
docker run -d \
  --name masterdnsvpn \
  --restart unless-stopped \
  -e DOMAIN=v.example.com \
  -v $(pwd)/data:/data \
  -p 53:53/tcp -p 53:53/udp \
  ghcr.io/masterking32/masterdnsvpn:latest
```

或 `docker-compose.yml`：

```yaml
services:
  masterdnsvpn:
    image: ghcr.io/masterking32/masterdnsvpn:latest
    restart: unless-stopped
    environment:
      - DOMAIN=v.example.com
    volumes:
      - ./data:/data
    ports:
      - "53:53/tcp"
      - "53:53/udp"
```

- 首次启动若没设 `DOMAIN` 会报错退出。
- 持久化数据在 `/data`：`server_config.toml` 和 `encrypt_key.txt`（从这里取密钥给客户端）。
- 支持多架构（amd64/arm/v5/v7/arm64/mips64le）。**宿主机不能再跑其它 DNS 服务占用 53**。
- MikroTik/RouterOS 容器：用 v7，把 UDP/TCP 53 做 DNAT 到容器，详见 README §2.2.7。

---

### 场景 C：从源码编译运行（开发者 / 自定义）

```bash
git clone https://github.com/masterking32/MasterDnsVPN.git
cd MasterDnsVPN
go build -o masterdnsvpn-server ./cmd/server
go build -o masterdnsvpn-client ./cmd/client

cp server_config.toml.simple server_config.toml
cp client_config.toml.simple client_config.toml
cp client_resolvers.simple client_resolvers.txt

./masterdnsvpn-server -config server_config.toml -log server.log
./masterdnsvpn-client -config client_config.toml -log client.log
```

Windows（PowerShell）把命令换成 `.\cmd\server`、`Copy-Item`、`masterdnsvpn-server.exe` 即可。
命令行参数：`-config` 配置路径、`-log` 日志路径、`-version` 打印版本。

---

### 场景 D：客户端在 Windows / macOS / Linux 桌面

1. 从 Releases 下对应平台 zip 解压。
2. 用文本编辑器打开 `client_config.toml`，至少改这 4 项：

```toml
DOMAINS = ["v.example.com"]        # 与服务器一致
DATA_ENCRYPTION_METHOD = 1         # 与服务器一致
ENCRYPTION_KEY = "服务器的 encrypt_key.txt 内容"
PROTOCOL_TYPE = "SOCKS5"
```

3. 编辑 `client_resolvers.txt` 放可用解析器（每行一个，支持 `IP` / `IP:PORT` / `CIDR` / `CIDR:PORT`）：

```
8.8.8.8
1.1.1.1:53
9.9.9.0/24
```

4. 运行客户端二进制。
5. 浏览器/应用设置 SOCKS5 代理 `127.0.0.1:18000`。

---

### 场景 E：手机使用（无官方 App）

| 方法 | 做法 |
| :-- | :-- |
| **共享电脑代理** | 客户端 `LISTEN_IP=0.0.0.0`，手机与电脑同网，手机设 SOCKS5 指向电脑 IP:18000 |
| **跑在中转服务器** | 主服务器在出口，客户端跑在一台中转机上 `LISTEN_IP=0.0.0.0`，手机连中转机 SOCKS5 |
| **接入现有面板** | 把面板出站指向 MasterDnsVPN 客户端的本地 SOCKS5 |
| **第三方安卓客户端** | 见 README §5.1（Hidden-Node / RevocGG 等独立项目） |

> ⚠️ `LISTEN_IP=0.0.0.0` 暴露到网络时，**务必开 SOCKS5 认证**（`SOCKS5_AUTH=true` + 用户名/密码），
> 否则同网任何人都能蹭你的隧道；建议同时改掉默认 `LISTEN_PORT`。

---

### 场景 F：作为出站接入 3X-UI / Xray 面板

客户端与面板同机运行后，在 3X-UI 里：
新建 Inbound（VLESS/VMess）→ Outbound 选 `Socks`，地址 `127.0.0.1`、端口 `18000`（开了认证就填账号密码）→
Routing Rules 把该 Inbound 指向这个 Outbound tag → 重启 Xray。
该 Inbound 的流量就会经 MasterDnsVPN 的 DNS 隧道出去。详见 README §5.3。

---

## 3. 解析器扫描（找可用 DNS，强烈建议做一次）

可用解析器质量直接决定隧道速度和稳定性。客户端自带扫描功能：

1. **前提**：服务器已运行，且 `client_config.toml` 已填对域名和密钥（否则全判失败）。
2. 把待测 IP（每行一个，可用 CIDR）放进 `client_resolvers.txt`。
3. 备份当前 config，临时改为快速扫描参数：

```toml
MIN_UPLOAD_MTU = 30
MIN_DOWNLOAD_MTU = 40
MAX_UPLOAD_MTU = 30          # Min=Max 避免二分探测，扫得快
MAX_DOWNLOAD_MTU = 40
MTU_TEST_PARALLELISM = 200   # 并发提高
MTU_TEST_RETRIES = 1
MTU_TEST_TIMEOUT = 1.0
SAVE_MTU_SERVERS_TO_FILE = true
MTU_SERVERS_FILE_FORMAT = "{IP}"   # 只输出 IP，便于复用
```

4. 运行客户端，等扫描完成关闭。旁边会生成成功列表的 `.txt`。
5. 把它作为新的 `client_resolvers.txt`，**恢复正常 config**，用健康解析器跑正式连接。

**MTU 调优经验**：MTU 太高 → 更多解析器失败、启动慢、丢包多；太低 → 慢但稳。
从示例配置起步，看扫描结果，质量差就略降 `MIN_UPLOAD_MTU/MIN_DOWNLOAD_MTU`，
想启动快就把 Min/Max 范围收窄。

---

## 4. 故障排查

| 问题 | 处理 |
| :-- | :-- |
| **端口 53 被占用**（Linux 常见 systemd-resolved） | 编辑 `/etc/systemd/resolved.conf` 设 `DNSStubListener=no`，然后 `sudo systemctl restart systemd-resolved`。**同机不能同时跑多个 DNS 隧道占 53** |
| **隧道连不上** | 检查客户端 4 项是否与服务器对齐（密钥/域名/加密方式/解析器）；密钥或域名错会导致包被当垃圾解析 |
| **DNS 还没生效** | `dig v.example.com NS` 和 `dig @ns.example.com v.example.com A` 验证委派；传播最长 48 小时 |
| **解析器全失败** | 扫描前确认服务器已运行且 config 已填密钥/域名；否则 MTU 测试无法进行 |
| **手机/局域网连不上** | 检查系统防火墙；`0.0.0.0` 时确认认证已开 |
| **弱链路丢包严重** | 提高 `PACKET_DUPLICATION_COUNT`、`PACKET_BLOCK_CONTROL_DUPLICATION`；换 `RESOLVER_BALANCING_STRATEGY=3`（最低丢包）|

---

## 5. 关键配置项速查

### 客户端 `client_config.toml`

| 参数 | 默认 | 说明 |
| :-- | :-- | :-- |
| `PROTOCOL_TYPE` | `SOCKS5` | 本地服务模式，`SOCKS5`（常规）或 `TCP`（固定转发单一目标） |
| `DOMAINS` | — | 隧道域名，须与服务器一致 |
| `DATA_ENCRYPTION_METHOD` | `1` | 加密方式 0–5，须与服务器一致 |
| `ENCRYPTION_KEY` | — | 共享密钥，须 = 服务器 `encrypt_key.txt` |
| `LISTEN_IP` / `LISTEN_PORT` | `127.0.0.1` / `18000` | 本地代理监听地址/端口 |
| `SOCKS5_AUTH` / `_USER` / `_PASS` | `false` | 暴露到网络时务必开认证 |
| `RESOLVER_BALANCING_STRATEGY` | `2` | 0/2 轮询 1 随机 3 最低丢包 4 最低延迟 5 混合 6 丢包后延迟 7/8 顶层随机/轮询 |
| `PACKET_DUPLICATION_COUNT` | `2` | 包复制份数，越高越稳但流量越大 |
| `LOCAL_DNS_ENABLED` | `false` | 开启客户端本地 DNS + 缓存，减少劫持 |
| `UPLOAD/DOWNLOAD_COMPRESSION_TYPE` | `0` | 0 关 1 ZSTD 2 LZ4 3 ZLIB |
| `MIN/MAX_UPLOAD/DOWNLOAD_MTU` | 38/150 / 100/500 | MTU 探测范围 |
| `LOG_LEVEL` | `INFO` | 排查时用 `DEBUG` |

### 服务端 `server_config.toml`

| 参数 | 默认 | 说明 |
| :-- | :-- | :-- |
| `DOMAIN` | — | 委派隧道域，须与客户端 `DOMAINS` 一致 |
| `PROTOCOL_TYPE` | `SOCKS5` | `SOCKS5`（从客户端载荷取目标）或 `TCP`（连 `FORWARD_IP:FORWARD_PORT`） |
| `DATA_ENCRYPTION_METHOD` | `1` | 须与客户端一致，非法值会被归一为 1 |
| `ENCRYPTION_KEY_FILE` | `encrypt_key.txt` | 密钥文件路径，不存在则启动时自动生成 |
| `UDP_HOST` / `UDP_PORT` | `0.0.0.0` / `53` | 监听地址/端口 |
| `USE_EXTERNAL_SOCKS5` | `false` | true 则经外部 SOCKS5 出站（链式/隐藏出口）；常规保持 false 直连 |
| `FORWARD_IP` / `FORWARD_PORT` | — | TCP 模式的固定目标，或外部 SOCKS5 地址 |
| `DNS_UPSTREAM_SERVERS` | `1.1.1.1:53` 等 | 隧道内真实 DNS 查询的上游（仅 DNS-over-tunnel 用） |
| `SESSION_TIMEOUT_SECONDS` | `300` | 会话无活动超时 |
| `MAX_CONCURRENT_REQUESTS` | `16384` | 入站请求队列容量，满了丢包 |
| `LOG_LEVEL` | `INFO` | 排查时用 `DEBUG` |

> 完整参数（ARQ/ping/worker/超时等几十项）见仓库 `*.toml.simple` 及 README §3.4/§3.5。

---

## 6. 安全与合规要点

- 这是科研/教育项目，无任何担保；测试环境外使用可能扰乱网络。
- 在受封锁地区用于绕过当地法律可能涉刑责，使用前自查当地法规，后果自负。
- `LISTEN_IP=0.0.0.0` 必须配 SOCKS5 认证，否则开放代理会被滥用。
- 加密优先选 AEAD（ChaCha20 / AES-GCM）；XOR 仅在极端追求开销时用，安全性弱。
- 仅在你拥有授权的网络/服务器上部署测试。
</content>
</invoke>
