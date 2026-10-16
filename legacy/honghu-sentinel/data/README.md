# data/ —— 数据目录说明

本目录**不存放真实运行数据**（已被 .gitignore 排除），只放脱敏样例。
程序运行时数据全部写入环境变量 `HONGHU_VAULT` 指向的「研究库」根目录，布局如下：

```
$HONGHU_VAULT/
├── 97_原始数据/                     # 原始数据（永久保存，永不覆盖）
│   └── YYYY-MM-DD/
│       └── raw_market.json          # 当日东财/腾讯/融资融券原始归档
├── 80_Agent_Feed/                   # 机器接口（给其他 Agent / Web 后端消费）
│   ├── YYYY-MM-DD_snapshot_agent.json
│   └── latest.json                  # 软链接 → 最新一日
├── 40_信号看板/YYYY-MM/
│   └── YYYY-MM-DD_MoneyRadar.md     # 人看的全量驾驶舱（Obsidian Markdown）
├── 00_首页.md                       # 首页浓缩区块（覆盖更新）
└── 99_每日数据包/                   # 旧主线数据包（主程序 share_packet 环节在写）
    ├── AI_INFRA_PM_YYYYMMDD.{json,md}
    ├── latest_PM.json → 软链接
    └── latest_PM.md   → 软链接
```

## 样例

- `sample/snapshot_sample.json`：`80_Agent_Feed/latest.json` 的**脱敏**版本
  （成本/仓位/盈亏已清零、本机路径已替换），用于合并开发时对齐字段契约。

## 迁阿里云后的建议布局

```
/var/lib/honghu/
├── raw/        ← 对应 97_原始数据
├── feed/       ← 对应 80_Agent_Feed
└── reports/    ← 对应 40_信号看板 的 md/html
```
代码中所有写入路径均由 `HONGHU_VAULT` 派生（见 `src/sentinel_config.py`），
迁移时只需改这一个环境变量，业务代码不用动。
