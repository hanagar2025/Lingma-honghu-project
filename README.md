# TIOS —— 科技投资操作系统（精炼版）

一个**规则驱动**的个人交易决策小程序。没有预测、没有推荐、没有Mock数据——只有一个大脑：把《交易操作系统V1.0》《主线龙头体系V2.0》《CTC框架》的铁律翻译成代码，每天生成一张**盘前四问**决策单，并记录你是否执行了它。

## 核心理念

> 规则在盘前写好，盘中不许改。体系的价值不在于预测对错，而在于执行一致性。

系统只回答四个问题：

1. **今天允许买入什么？**（三道闸门：阶段解禁 → 止跌三要素 → 仓位/现金/禁买检查）
2. **今天必须卖出什么？**（硬止损25% / 单日熔断12% / 破均线 / 组合熔断，优先级最高）
3. **继续持有什么？**（没有触发条款的一律不动）
4. **今天禁止做什么？**（下跌期禁买、单股12%/板块30%/主题45%上限、现金10%红线）

## 完整闭环

```
① 数据    腾讯行情（免费，无需token）→ 真实日K落库 stock_daily
② 决策    TIOS规则引擎：市场阶段判定 + 卖出条款 + 买入闸门 → 盘前四问
③ 留痕    决策报告入库 decision_reports，卖出指令生成待执行记录
④ 反馈    盘后回填"是否执行"→ 铁律执行率统计（体系有效性的核心指标）
```

工作日 17:00（北京时间）自动运行；也可在页面上一键手动触发。

## 技术栈与结构

- 后端：Node.js 20 + Express + TypeScript + MySQL（唯一外部依赖）
- 前端：React 18 + Vite + Ant Design + Redux Toolkit

```
backend/src/
  services/tios/        # 大脑：纯函数规则引擎（阶段判定/卖出条款/买入闸门/赔率/盘前四问）
  services/marketData.ts # 数据：腾讯行情接入（报价/日K/搜索）
  services/tiosService.ts# 编排：数据库状态 → 引擎输入 → 报告留痕
  services/scheduler.ts  # 定时：工作日17:00自动跑闭环
  routes/               # auth / portfolio / market / tios
frontend/src/
  pages/DailyReport.tsx  # 盘前四问（主页）：决策单 + 执行回填 + 规则卡 + 账户状态
  pages/Portfolio.tsx    # 持仓管理（板块/主题字段用于仓位闸门）
交易操作系统/           # 体系文档：规则条款原文
战略组合2026-2030/      # 体系文档：战略框架与作战地图
```

## 在浏览器里看今天的分析（推荐，不需要数据库和登录）

驾驶舱有四个出口，读的是**同一份数据**，因此不可能给出互相矛盾的结论。

首次在一台新机器上（把 `~/tios` 换成你想放的目录）：

```bash
git clone -b cursor/decision-audit-c819 https://github.com/hanagar2025/Lingma-honghu-project.git ~/tios
cd ~/tios
npm install
npm run web
```

`npm run web` 会自己打开浏览器；没打开就手动开 `http://localhost:5173`。
之后每天只要两步：`cd ~/tios` 然后 `npm run web`。

`npm run web` 做两件事：先用命令行引擎直连行情算出当日快照
（落到 `frontend/public/data/today.json`），再以离线模式启动前端读它。
**全程不碰 MySQL，也不需要登录** —— 因为"今天没看"重复三次，系统就等于不存在。

| 出口 | 命令 | 适用场景 |
|---|---|---|
| 浏览器（React 五层驾驶舱） | `npm run web` | 每天盘后看，可展开追溯每个数字 |
| 单文件 HTML | `npm run daily` → `backend/src/services/cockpit/data/reports/` | 发到手机、存档、离线翻看 |
| 命令行 | `npm run daily` | 需要归档变化台账与决策审计时 |

离线模式下拿不到的东西会**显式标注缺失**，不用默认值伪装成通过项：
执行债务明细与「标记已执行」按钮、KPI E1–E4、家庭年度刚性支出 —— 这三项存在数据库里。
需要勾选清偿执行债务时，才需要下面的完整模式。

要做成静态站点（可放任意静态托管）：

```bash
npm run web:build  # 产出 frontend/dist，含快照
npm run web:serve
```

## 手机上看

两条路，都不需要把数据放到公网。

### 路一：同一个 WiFi（可实时刷新）

```bash
npm run web:lan
```

它会印出局域网地址并**渲染成二维码**，用手机相机扫即可打开，不需要手抄数字。
终端里的码扫不出来时（部分终端的行距会把半块字符拉变形），
脚本另存了一张清晰 PNG 并在 macOS 上自动用「预览」打开，扫那张。

连不上时按顺序查三条：

1. 确认跑的是 `web:lan`。`npm run web` 只监听 localhost，**手机连不上**。
2. 手机与电脑必须在同一个 WiFi。访客网络、部分路由器的「AP 隔离」会禁止设备互访。
3. macOS 防火墙：系统设置 → 网络 → 防火墙 → 选项，允许 node 接受传入连接。

### 路二：隔空投送（完全不经过网络，一定能看到）

```bash
npm run report
```

生成当日报告并在 Finder 中选中它，然后右键 → 共享 → 隔空投送 → 选 iPhone，
手机上选「用 Safari 打开」。窄屏已单独适配：表格横滑，**不隐藏任何一列**
（手机上看不到的那列，正好可能是法定减仓理由）。完全离线，可长期存档翻看。

路一会被防火墙、访客网络、AP 隔离挡住，而这些都不是代码能修的；
路二没有任何中间环节可失败，所以它是兜底方案。

## 部署到自己的域名（公网可访问）

公网域名意味着**全世界都能请求这个地址**，而页面上有全部持仓、股数、成本与总资产。
所以不是"先发上去再想安全"，而是数据在离开本机之前就必须已经加密。

### 加密快照

```bash
TIOS_PASSPHRASE='你的长口令' npm run web:deploy
```

它做三件事：

1. **加密**快照 —— AES-GCM-256 + PBKDF2-SHA256（60 万次迭代）。
   落盘就是密文，写盘前先解一次回验，内容不符则中止（避免生成打不开的密文）。
2. **删除明文** —— 明文与密文并存时构建会把两份都拷进 `dist/`，
   密文旁边躺着明文等于没加密。这类失误没有任何报错，所以在写入时就消除可能性。
3. **发布前体检** —— 逐项检查产物，任一项不过就退出非零码，明确写"不要发布"。

体检查的东西：明文快照是否存在、密文是否合法、迭代次数是否够、
任何文件是否含持仓名（连表单占位示例都算 —— 这条真抓到过一次）、
`data/` 目录是否混入账户字段、审计档与变化台账是否被误打包。

口令**不在文件里，也不在服务器上，服务端自己解不开**。打开页面时手动输入一次，
由浏览器在本地派生密钥解密。刻意不提供"记住口令"：存进 localStorage
等于把加密降级成"URL 没人知道"。

### 托管必须是 HTTPS（硬性技术要求）

浏览器只在安全上下文（HTTPS 或 localhost）提供 WebCrypto。
`http://` 下解密会直接报错 —— 这不是习惯问题，是解不开。
因此 `npm run web:lan` 那条局域网路径**不能用加密快照**（局域网是 http），
局域网就用明文快照，公网才用密文。

### 先拿到 SSH 访问

**阿里云查不到已有私钥。** 私钥只在创建密钥对时下载那一次，阿里云自己也不留副本，
所以"在哪里查看"没有答案 —— 只能新配一把。

控制台的官方做法是"创建密钥对 → 绑定实例"，但**绑定会重启实例**。
下面这条路不碰阿里云的密钥对功能，因此不重启、线上服务不中断：

```bash
./scripts/setup-ssh-key.sh
```

它在本机生成一把 ed25519 密钥（私钥不离开你的电脑），并打印出一条命令 ——
粘贴进阿里云 Workbench 的浏览器终端即可。那条命令只往 `authorized_keys`
追加一行，不删任何东西、不重启任何服务。

也可以完全不用密钥：如果你知道 root 密码，直接 `ssh root@39.104.86.200` 即可。
部署脚本复用一条 SSH 连接，全程只需输一次密码。

### 具体到 hhwealth.cc（一条命令部署）

现状（2026-08-14 实测）：域名解析到阿里云 ECS `39.104.86.200`，nginx/1.18.0 (Ubuntu)，
Let's Encrypt 证书（8/11 签发、11/9 到期，certbot 自动续期），**HTTPS 已配好**。

```bash
DEPLOY_HOST=39.104.86.200 TIOS_PASSPHRASE='你的长口令' ./scripts/deploy-ecs.sh
```

先加 `DRY_RUN=1` 跑一次，它会把**将在服务器上执行的完整脚本打印出来**且不连服务器。
涉及删文件与改 nginx 配置的操作，应当先看清楚再跑。

脚本做六步：无条件备份现状 → 探测证书路径 → 部署产物 → 写站点配置 →
校验并下线旧站点 → 重载。`nginx -t` 不通过会自动回滚站点启用状态。

> ### ⚠ 不要把服务器"删干净重装"
>
> 那台机器上的 Let's Encrypt 证书与 certbot 续期配置是**本项目的硬依赖** ——
> 加密快照的解锁用 WebCrypto，而浏览器只在 HTTPS 下提供它。
> 重装会把证书、续期配置与 ACME 账户一起清掉，然后要重新申请重新配，
> 而这跟"下线旧应用"是两件毫不相干的事。
>
> 部署脚本因此只做三件事：备份、换文件、换站点配置。系统、nginx、证书一概不动。
> 旧应用的文件与 nginx 配置会打包留在服务器 `/root/hhwealth-backup-*.tar.gz`。

脚本里两个刻意的选择：

- **探测证书路径而不是假设。** 路径写错会让 HTTPS 直接起不来，
  而那会连带让解锁失效。读不出路径就中止退出，不猜。
  机器上有多张证书时按域名匹配 —— 挑错证书会报名称不匹配，
  浏览器一报错就不给 WebCrypto。
- **`data/*.json` 强制 `no-store`。** 快照每个交易日都换，
  缓存住会让人看着昨天的数据做今天的决定 —— 这种错误没有任何提示，页面看起来完全正常。

每个交易日更新数据只需重传一个文件（约 280KB），nginx 无需重载：

```bash
TIOS_PASSPHRASE='你的长口令' npm run web:deploy
scp frontend/dist/data/today.enc.json root@39.104.86.200:/var/www/tios/data/
```

### 挂在子路径（保留根目录现有应用时）

若根目录还要跑别的东西，我们可以只占一个子路径：

```bash
TIOS_PASSPHRASE='口令' BASE_PATH=/tios/ npm run web:deploy
BASE_PATH=/tios/ npm run web:package
```

> **子路径部署必须带 `BASE_PATH`。** 不带的话产物会引用 `/assets/...`，
> 浏览器去站点根目录找资源。症状是**白屏，但所有请求都是 200**
> （被 SPA 回退接走），从现象上完全看不出原因。
> `BASE_PATH` 同时驱动 Vite 的 `base` 与 React Router 的 `basename`，两者不会不同步；
> `web:package` 还会再校验一遍产物里的实际路径，不一致就拒绝打包。

### 换成独立托管（可选）

两条路，差别主要在备案：

| | Cloudflare Pages | 阿里云 OSS + CDN |
|---|---|---|
| ICP 备案 | 不需要（服务器在境外） | **需要**，未备案会被拦 |
| HTTPS | 自动签发，零配置 | 需自行申请并配置证书 |
| 国内访问速度 | 不稳定，偶有波动 | 快 |
| 额外访问控制 | Cloudflare Access 免费版可加邮箱验证码登录 | 需自建 |
| 费用 | 免费 | 按量计费 |

推荐先走 Cloudflare Pages 把链路跑通（不涉及备案，当天可用）：

1. Cloudflare 控制台 → Workers & Pages → 创建 Pages 项目 → 上传 `frontend/dist`
2. 自定义域名填 `hhwealth.cc`（或 `app.hhwealth.cc`）
3. 回阿里云域名控制台，把 NS 改为 Cloudflare 给出的两条，或加一条 CNAME 指向 Pages 域名
4. 可选但建议：Cloudflare Zero Trust → Access → 给这个域名加一条 Email OTP 策略，
   只允许你的邮箱。这样在加密之外多一层边缘鉴权，**两层都失效才会暴露**

> 若要放在境内（阿里云 OSS/ECS），先在阿里云备案控制台确认 `.cc` 当前是否在
> 可备案后缀名单内 —— 名单会变动，以控制台的实际结果为准。备案通常需要数周。

> **不要用 GitHub Pages。** 免费与 Pro 计划下，即使仓库是私有的，
> 发布出去的站点也是公开的，而且没有任何访问控制可加。

## 三个真踩过的坑

**一、`致命错误：不是 Git 仓库` / `Could not read package.json`**

命令是在家目录（`~`）下跑的，那里既没有 `.git` 也没有 `package.json`。
先 `cd` 到项目目录。确认当前位置：`pwd`；确认是不是项目根：`ls package.json`。

**二、`cd: too many arguments`**

zsh 交互式 shell **默认不把 `#` 当注释**（`interactive_comments` 未开启），
所以 `cd /some/path   # 说明文字` 里的说明文字会被当成 `cd` 的额外参数。
粘贴命令时不要带行尾注释；本 README 的命令块都不含注释。

**三、手机打不开 `192.168.1.x`**

`192.168.1.x` 是**占位写法，不是可用地址**。这个坑是文档自己制造的，
所以 `npm run web:lan` 现在直接给二维码，不再要求任何人手抄数字。

**四、手机连不上局域网地址**

多半是跑了 `npm run web`（只监听 localhost）而不是 `npm run web:lan`。
其次是 macOS 防火墙与路由器 AP 隔离。三条都排除不掉就走 `npm run report`
隔空投送 HTML —— 那条路不经过网络，没有中间环节可失败。

## 持仓数据的存放位置（关系到隐私）

`backend/src/services/cockpit/data/portfolio.json` 记录现金、峰值净值、每只标的的股数与成本。
它默认**在版本库里**，因此仓库若是公开的，这些数字就是公开的。审计档
（`data/audits/*.md`）与变化台账（`governance/data/changelog/*.json`）同样含仓位百分比与减仓金额。

两种处理方式，按需要选一种：

1. **把仓库设为 Private**（推荐）—— 保留跨机器同步，一处设置即可。
   注意历史提交不会自动消失，改为私有只能止住继续暴露。
2. **把持仓文件放到版本库之外** —— 所有命令都支持 `PORTFOLIO=` 指定路径：

   ```bash
   PORTFOLIO=~/.tios/portfolio.json npm run web:snapshot
   ```

   此时可以 `git rm --cached backend/src/services/cockpit/data/portfolio.json` 并加入 `.gitignore`。
   代价是持仓不再随仓库同步。

## 完整模式（需要数据库，可写入执行记录）

```bash
# 1. 准备 MySQL，创建数据库
mysql -e "CREATE DATABASE stock_decision CHARACTER SET utf8mb4"

# 2. 配置环境变量
cp backend/env.example backend/.env   # 填入数据库密码

# 3. 安装依赖并启动（前端 5173 / 后端 5000）
npm install
npm run dev
```

首次使用：注册账号 → 「持仓管理」录入持仓（含板块/主题）→ 「盘前四问」填入现金与净值高点 → 点击「同步行情并生成今日决策」。

接口不可用时前端会**自动降级**到离线快照并在页面顶部说明原因 ——
后端挂掉时还能看到当天数据，比弹一个报错更有用。

## 验证

```bash
npm run tios:selftest   # 引擎自测：用2026-07-16/17真实行情验证全部条款
npm test                # 后端测试
```

## 主要API

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/tios/run` | 一键闭环：同步K线→生成盘前四问→入库 |
| GET | `/api/tios/report/latest` | 最新决策报告 |
| PUT | `/api/tios/rule-cards/:code` | 修改个股规则卡（止损/熔断/禁买） |
| PUT | `/api/tios/account` | 更新现金与净值高点 |
| PUT | `/api/tios/executions/:id` | 回填执行记录 |
| GET | `/api/tios/executions/stats` | 铁律执行率 |
| POST | `/api/tios/risk-reward` | 赔率计算（RR≥3才允许建仓） |

## 铁律的保护条款

规则化卖出遇到极端事件（公司公告、海外重大事件、交易所异常）时，允许**盘前书面引用**保护条款，效果仅为"推迟到收盘再确认"，滥用记为违规。详见 `战略组合2026-2030/TIOS六层架构-估值赔率与领先指标V1.0.md`。
