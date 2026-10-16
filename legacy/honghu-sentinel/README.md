# 资金哨兵 · Honghu Sentinel

> 只盯**真实资金**的 A 股观察系统：回答「钱在往哪走、个股资金有没有恶化」，
> **只观察、不产生买卖指令**。每个交易日收盘后自动采集、判定、归档、推送。

- 语言/依赖：Python ≥ 3.9，**零第三方依赖**（纯标准库）
- 运行方式：本机 launchd 定时（现状）→ 计划迁移阿里云 + 自有域名（目标）
- 角色分工：本系统是「👁 看」的**资金哨兵**；买卖动作由独立的「✋ 交易执行单」系统负责，两者模块隔离，禁止跨模块串证

---

## 一、它在做什么

1. **采集**（收盘后）：个股行情/成交额（腾讯+东财双源）、融资融券余额（东财数据中心，真实 T+1）、行业板块成交额（东财 push2，失败自动降级）
2. **判定**：三舱状态机
   - ① 持仓舱（8 只）：积累 / 趋势 / 分歧 / 衰竭 / 爆发
   - ② 观察舱（左侧雷达池 19 只）：观察 / 启动 / 趋势 / 持续
   - ③ 市场雷达（31 个一级行业）：启动 / 趋势 / 爆发 / 衰竭 / 衰退
   - 价资同步性：有效推动 / 真分歧 / 顶部背离 / 抛压减轻 / 撤离
3. **产出**：原始归档（永不覆盖）+ 机器 JSON + 人看的 Markdown + 网页驾驶舱 + 微信双消息
4. **边界**：资金数据只作观察层证据，不预测股价、不输出买卖动作；状态机阈值为 V1.0 初定值

数据原则：**只用真实资金**（成交额占比 + 融资净买入 + ETF 份额），估算的「主力净流入」仅展示、不投票。

---

## 二、目录结构

```
honghu-sentinel/
├── src/
│   ├── honghu_snapshot.py    # 主程序：采集 + 状态机 + 全部落盘（~150KB，核心）
│   ├── push_wechat.py        # 【过渡适配器】PushPlus 微信双消息推送
│   ├── publish_web.py        # 【过渡适配器】静态驾驶舱渲染 + CloudBase 上传
│   ├── share_packet.py       # 旧主线数据包复制工具（主程序仍在调用）
│   └── sentinel_config.py    # 统一配置：环境变量 > settings.json > 本机凭证文件
├── config/
│   ├── settings.example.json # 配置模板（复制为 settings.json 填值，不入库）
│   ├── com.honghu.daily-snapshot.plist  # macOS launchd 模板（占位符）
│   ├── install.sh            # 安装 launchd 定时任务（交易日 15:35）
│   └── uninstall.sh
├── docs/                     # 设计文档（数据字典/架构/路线图）
├── data/
│   ├── README.md             # 运行时数据目录布局
│   └── sample/snapshot_sample.json  # 脱敏后的 latest.json 样例（字段契约）
├── requirements.txt          # 核心零依赖；可选 tcb CLI 说明
└── .gitignore
```

主程序在第 9.6 / 9.7 步以子进程方式调用两个适配器；适配器失败**只记录日志，不影响快照落盘**。

---

## 三、快速开始

```bash
# 1. 配置（二选一）
cp config/settings.example.json config/settings.json   # 填 CloudBase 等配置
# 或用环境变量：HONGHU_VAULT / HONGHU_CLOUDBASE_ENV_ID / HONGHU_SITE_TOKEN

# 2. 指定数据根目录（默认 ~/鸿鹄研究库，布局见 data/README.md）
export HONGHU_VAULT=/path/to/vault

# 3. 手动跑一次（建议先用真实环境验证，不装定时也能用）
python3 src/honghu_snapshot.py --vault-dir "$HONGHU_VAULT"

# 4. macOS 定时（可选；服务器请用 cron/systemd）
bash config/install.sh
```

微信推送另需：在 `$HONGHU_VAULT/98_自动化/web_site/.pushplus_token` 放 PushPlus token（PushPlus 账户须实名认证）。

---

## 四、数据流

```
东财/腾讯 API
   │  （16:30 行情齐全；融资融券 T+1 次日披露）
   ▼
honghu_snapshot.py ──► 97_原始数据/YYYY-MM-DD/raw_market.json   （永久归档）
   │
   ├─► 40_信号看板/.../YYYY-MM-DD_MoneyRadar.md                 （人看，Obsidian）
   ├─► 00_首页.md 资金画像区块
   ├─► 80_Agent_Feed/latest.json                                （机器接口）
   │
   ├─► publish_web.py ──► 本地 site/ ──tcb──► CloudBase 静态网页 + /api/*.json
   └─► push_wechat.py ──► PushPlus ──► 微信①结论卡片 ②纯文本数据包（可直接复制给 AI）
```

给其他 AI/Agent 分析的两种方式：
- **机器**：读取 `80_Agent_Feed/latest.json`（字段见脱敏样例）
- **人转发**：微信第②条纯文本消息，平台原生「复制原文内容」即得完整数据包（数据字典 + 持仓全字段 + 观察舱 + 15 日趋势 + 引导问题），不依赖网页

---

## 五、配置项

| 环境变量 | 含义 | 默认/来源 |
|---|---|---|
| `HONGHU_VAULT` | 数据根目录 | `~/鸿鹄研究库` |
| `HONGHU_CLOUDBASE_ENV_ID` | 腾讯云 CloudBase 环境 ID | settings.json |
| `HONGHU_SITE_TOKEN` | 网页随机路径 token | settings.json / 旧机 .token 文件 |
| `HONGHU_SITE_ROOT` | 网页发布工作区目录 | `$HONGHU_VAULT/98_自动化/web_site` |
| PushPlus token | 微信推送凭证 | `$HONGHU_VAULT/98_自动化/web_site/.pushplus_token`（600） |

---

## 六、与「交易执行单」系统合并的注意事项

另一套程序（收盘作战/执行单）将与本仓库合并，合并时建议：

1. **保持角色边界**：资金哨兵只产出观察结论与结构化数据；交易动作的生成与执行留在执行单侧。两侧通过 `latest.json` 契约解耦，不直接互调内部函数。
2. **字段契约以样例为准**：`data/sample/snapshot_sample.json` 是最新输出结构；合并后若改字段，先改样例与 `docs/数据字典`。
3. **共享底层数据**：行情/成交额/融资融券的采集只保留一份（本主程序），避免双系统重复请求数据源。
4. **人工基线不机器臆测**：产业阶段 R0–R4、盈利/订单等级等人工字段（雷达池配置内）由人工周度维护。

---

## 七、阿里云 + 自有域名迁移路线（计划）

当前微信/CloudBase/本机 launchd 均为**过渡形态**，目标是服务器 + 自有域名上的数据查看与分析服务：

| 现状 | 目标 | 处理 |
|---|---|---|
| 本机 launchd 15:35 | 服务器 cron/systemd/容器定时 | 替换 config/install.sh 对应物 |
| CloudBase 静态页 + tcb 上传 | 自有域名 Web 服务（如 FastAPI/Flask + 前端） | **移除 publish_web.py 的 deploy**，保留其 HTML 渲染/数据包拼装逻辑作为视图层参考 |
| PushPlus 微信双消息 | Web 站内查看；微信/小程序按需保留或下线 | push_wechat.py 标记为可插拔通知渠道（Notification 接口化） |
| 本地 Markdown/Obsidian | DB 或对象存储 + Web 渲染 | 写入路径已全部由 `HONGHU_VAULT` 派生，改一处即可 |
| token 落本机文件 | 服务端配置中心/环境变量/密钥管理 | sentinel_config.py 是唯一收口，替换其实现即可 |

建议演进顺序：**先上服务器跑通定时采集与 JSON 产出 → 再做 Web 读取层（自有域名）→ 最后决定通知渠道保留哪些**。

---

## 八、安全

- 任何真实 token / CloudBase 环境 ID / 站点路径 token 都**不在代码里**，且被 .gitignore 排除
- 持仓成本、仓位、盈亏属个人隐私；仓库自带样例已全部脱敏，**推送公开仓库前勿放入真实 latest.json**
- 网页驾驶舱靠随机路径 token 做隐蔽保护，不等同于鉴权；上自有域名后应加正式登录

## 九、文档

- [主线迁移雷达 V1.0 数据字典+触发规则](docs/主线迁移雷达V1.0_数据字典+触发规则.md)
- [AI 产业链轮动监测系统 V1.0 架构需求](docs/AI产业链轮动监测系统_V1.0_架构需求.md)
- [V1.0 差距分析与实施路线图](docs/V1.0_差距分析与实施路线图.md)
- [运行时数据目录布局](data/README.md)
