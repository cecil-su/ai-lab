# MasterDnsVPN 从零部署 Checklist（Vultr + Cloudflare）

> 配套文档：原理与配置详解见 `docs/masterdnsvpn-deployment.md`
> 适用：在 Vultr 租一台墙外 VPS + 用 Cloudflare 管理域名，跑通 MasterDnsVPN
> 整理日期：2026-06-13

照着从上往下做，每步都有「成功标志」，没达到就别进下一步。
全程把这几个值记在手边，后面反复用到：

```
服务器 IP   = ____________________   (开通后得到)
主域名      = example.com            (你自己的域名)
隧道子域    = v.example.com          (委派给服务器的子域)
NS 主机名   = ns.example.com         (指向服务器 IP)
加密密钥    = ____________________   (装完服务端得到)
本地代理    = 127.0.0.1:18000
```

---

## 准备清单（开始前先备齐）

- [ ] 一个**域名**（已买，且 DNS 托管在 Cloudflare）
- [ ] 一个 **Vultr 账号**（已充值，几美元即可）
- [ ] 一个 **Cloudflare 账号**（域名已加进去、NS 已生效）
- [ ] 本机一个 **SSH 工具**（Win 用 PowerShell 自带的 `ssh`，或 Termius/MobaXterm）

---

## 第 1 步：开通 Vultr 服务器

- [ ] Products → **Deploy New Server**
- [ ] 类型选 **Cloud Compute - Shared CPU**
- [ ] CPU 标签选 **Regular Performance**（或 High Performance）
- [ ] 配置选 **1 vCPU / 1GB / 25GB / 1TB（$5.00/mo）那一行**
      ⚠️ 别选 $2.50 那行（标着 **IPv6 Only**，没法用）
- [ ] **Location**：选 Tokyo / Seoul / Singapore（亚洲低延迟）
- [ ] **OS**：选 **Ubuntu 24.04 LTS**（或 22.04）
- [ ] 其它默认，点 **Deploy**，等 1–2 分钟变成 Running

**成功标志**：服务器状态 Running，拿到一个**公网 IPv4 地址**和 root 密码。
→ 把 IP 填到上面的「服务器 IP」。

---

## 第 2 步：登录 + 先测 UDP 53（最关键，先测再干活）

本机打开 PowerShell：

```powershell
ssh root@你的服务器IP
# 首次会问 yes/no，输 yes；再输 Vultr 给的 root 密码
```

登录后，在服务器上先临时占用 53 端口当监听：

```bash
# 装个小工具并临时监听 UDP 53
apt update -y && apt install -y netcat-openbsd
nc -u -l -p 53
# 这个命令会一直挂着，不要关
```

**另开一个本机 PowerShell 窗口**，往服务器 53 端口发包测试：

```powershell
# Windows 没有 nc，用这个测 UDP 53 是否可达
Test-NetConnection 你的服务器IP -Port 53 -InformationLevel Detailed
```

> Test-NetConnection 对 UDP 支持有限，更可靠的判断放到第 5 步用 `dig` 验证。
> 这里主要确认能连上、Vultr 没在防火墙层挡掉。Vultr 默认放行 53，一般没问题。

回到服务器窗口，**按 `Ctrl+C` 停掉 nc 监听**（重要，否则占着 53 装不了服务端）。

**成功标志**：能正常 SSH 进服务器。（53 的最终验证在第 5 步做。）

---

## 第 3 步：在 Cloudflare 配 DNS 委派

登录 Cloudflare → 选中你的域名 → 左侧 **DNS → Records**：

- [ ] **加 A 记录**（服务器地址）
  - Type: `A`
  - Name: `ns`
  - IPv4 address: `你的服务器IP`
  - Proxy status: **DNS only（灰色云朵，务必点成灰的，不能是橙色）** ⚠️
  - Save

- [ ] **加 NS 记录**（委派子域）
  - Type: `NS`
  - Name: `v`
  - Nameserver: `ns.example.com`（即上面那条 A 记录的全名）
  - Save

**成功标志**：DNS 列表里能看到这两条记录，A 记录是灰色云朵。
> DNS 传播需要几分钟到几小时，先继续下一步装服务端，第 5 步再验证。

---

## 第 4 步：解决端口 53 占用 + 装服务端

Ubuntu 默认 `systemd-resolved` 占用 53，先放掉：

```bash
# 编辑配置
nano /etc/systemd/resolved.conf
# 找到 #DNSStubListener=yes，改成（去掉#）：
DNSStubListener=no
# Ctrl+O 回车保存，Ctrl+X 退出

systemctl restart systemd-resolved
```

放行防火墙（如果开了 ufw）：

```bash
ufw allow 53/udp 2>/dev/null; ufw reload 2>/dev/null; echo done
```

跑官方一键安装脚本：

```bash
bash <(curl -Ls https://raw.githubusercontent.com/masterking32/MasterDnsVPN/main/server_linux_install.sh)
```

- [ ] 脚本问域名时，填 **`v.example.com`**（必须和 NS 记录的子域一致）
- [ ] 等脚本装完、自动启动

**成功标志**：脚本结束时终端打印出**加密密钥**，并写入 `encrypt_key.txt`。
→ 复制这串密钥，填到顶部「加密密钥」。查看密钥也可以：

```bash
cat encrypt_key.txt
```

---

## 第 5 步：验证服务端 + DNS 委派都通了

在**本机** PowerShell 跑（需要 dig，Windows 可装或用在线 dig 工具）：

```powershell
# 1) 验证委派生效：应返回 ns.example.com
nslookup -type=NS v.example.com

# 2) 直接问你的服务器：应能收到响应（不超时即说明 UDP 53 入站通了）
nslookup v.example.com 你的服务器IP
```

或在**服务器上**自测：

```bash
dig @127.0.0.1 v.example.com A
```

**成功标志**：
- NS 查询返回 `ns.example.com`
- 直接查服务器 IP 能拿到响应、不超时
→ 说明：委派 OK + 服务端在跑 + UDP 53 入站通。三个都过才进下一步。

> 若超时：回查第 3 步 A 记录是不是灰云朵、第 4 步服务端是否在跑（`systemctl status` 或看进程）、
> Vultr 控制台 Firewall 有没有挡 UDP 53。

---

## 第 6 步：本机装客户端 + 配置

- [ ] 从 [Releases](https://github.com/masterking32/MasterDnsVPN/releases/latest) 下载对应平台包
      （Windows 选 `MasterDnsVPN_Client_Windows_AMD64.zip`），解压
- [ ] 用记事本打开 `client_config.toml`，改这 4 项：

```toml
DOMAINS = ["v.example.com"]                 # 和服务器一致
DATA_ENCRYPTION_METHOD = 1                  # 和服务器默认一致（脚本默认通常是 1）
ENCRYPTION_KEY = "粘贴第4步拿到的密钥"
PROTOCOL_TYPE = "SOCKS5"
```

- [ ] 编辑 `client_resolvers.txt`，先放几个公共 DNS 试通：

```
8.8.8.8
1.1.1.1
9.9.9.9
```

- [ ] 双击运行客户端 exe（保持窗口开着）

**成功标志**：客户端日志显示会话建立 / 解析器健康，没有一直报错。

---

## 第 7 步：浏览器设代理 + 验证能上网

- [ ] 给浏览器设 **SOCKS5 代理 `127.0.0.1:18000`**
      （推荐用 SwitchyOmega 插件，新建 SOCKS5 情景，地址 127.0.0.1 端口 18000）
- [ ] 访问一个境外网站，或在能看到出口 IP 的网站上确认 IP 变成了服务器 IP

**成功标志**：网页能打开，且出口 IP = 你的 Vultr 服务器 IP。🎉 全流程跑通。

---

## 第 8 步（可选但强烈建议）：扫描优质解析器提速

公共 DNS 能通后，跑一次解析器扫描找更快更稳的，详见
`docs/masterdnsvpn-deployment.md` 第 3 节。简述：

1. 备份 `client_config.toml`
2. 临时改成快速扫描参数（Min=Max MTU、提高并发、`SAVE_MTU_SERVERS_TO_FILE=true`、`MTU_SERVERS_FILE_FORMAT="{IP}"`）
3. `client_resolvers.txt` 放大批待测 IP，运行客户端扫描
4. 用生成的成功列表替换 `client_resolvers.txt`，**恢复正常配置**，重跑

---

## 故障排查速查

| 现象 | 排查 |
| :-- | :-- |
| SSH 连不上 | Vultr 控制台看服务器是否 Running、IP/密码是否对 |
| `nslookup NS` 返回不了 ns | DNS 还没传播（等）；或 NS 记录名/值填错 |
| 查服务器 IP 超时 | A 记录不是灰云朵 / 服务端没跑 / UDP 53 被占或被挡（重做第 4 步）|
| 服务端装不上、报 53 占用 | 第 4 步的 `DNSStubListener=no` 没生效，重启 systemd-resolved |
| 客户端一直报错连不上 | 4 项必对齐：密钥/域名/加密方式/解析器；密钥或域名错会全乱码 |
| 能连但极慢 | 解析器质量差，做第 8 步扫描；或调低 MTU、提高 `PACKET_DUPLICATION_COUNT` |
| 浏览器不走代理 | 确认 SwitchyOmega 选的是 SOCKS5、端口 18000、客户端窗口还开着 |

---

## 安全 & 合规提醒

- 仅在**你有授权的网络做研究/测试**；用于绕过当地法律风险自负。
- 若把客户端 `LISTEN_IP` 改成 `0.0.0.0` 共享给别人，**必须开 SOCKS5 认证**。
- 服务器 root 密码尽快改强密码或换 SSH 密钥登录。
- 加密优先用 AEAD（ChaCha20/AES-GCM），别用 None。
</content>
