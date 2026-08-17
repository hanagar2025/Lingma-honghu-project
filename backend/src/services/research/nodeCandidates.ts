// 产业链节点覆盖 —— 研究层名单
//
// 委员会 2026-08-13 指出：13 个产业链节点无覆盖标的，这是"高度有价值的结果"，
// 因为系统没有把研究空白隐藏掉。下一步是逐个建立：
//   节点 → 龙头 → 产品 → 客户 → 收入 → 扣非利润 → 利润增速 → 估值 → 股价 → 资金
//
// ⚠ 本文件与决策域**物理隔离**，这是刻意的：
//
//   1. 这里的名单**不进入** msr/universe.ts 的 MAINLINES，因此 MSR 扫不到它们，
//      不可能产出买入候选。「发现 ≠ 许可」在数据层就成立，而不是靠下游闸门补救。
//   2. 因此本文件**不改变规则指纹**（21条 / 06ed04bb9084 保持不变），冻结期不被破坏。
//      加研究标的不是加规则。
//   3. research/selftest.ts 断言这两个集合永不相交。
//
// 名单性质：这些是"该节点的龙头**可能**是谁"的研究起点，**全部未核验**。
// 节点归属、主线收入占比、是否真龙头，都需要按上述链条逐项建档后才能成立。

export interface NodeCandidate {
  mainlineId: 'optical' | 'semi' | 'compute' | 'power'
  /** 对应 cockpit/nodes.ts 的节点名 */
  node: string
  code: string
  name: string
  /** 为什么把它列为该节点的研究起点。一句话，不作为结论 */
  thesis: string
}

/**
 * 13 个无覆盖节点的研究起点名单。
 *
 * 每个节点给 2 只，避免"一只标的等于一个节点"的单点误判 ——
 * 若两只标的的产业与利润读数相反，说明节点定义本身有问题。
 */
export const NODE_CANDIDATES: NodeCandidate[] = [
  // ── AI光通信（6个无覆盖节点） ──
  { mainlineId: 'optical', node: 'EML', code: '688048', name: '长光华芯', thesis: '光芯片平台，EML/VCSEL 路线，需核 AI 相关收入占比' },
  { mainlineId: 'optical', node: 'EML', code: '300502', name: '新易盛', thesis: '仅作对照：模块厂对 EML 的采购方向可反推上游景气，本身不属该节点' },
  { mainlineId: 'optical', node: '硅光', code: '000988', name: '华工科技', thesis: '硅光模块与光器件布局，需核硅光收入是否已独立成规模' },
  { mainlineId: 'optical', node: '硅光', code: '301205', name: '联特科技', thesis: '中长距模块，硅光路线跟随者，需核客户结构' },
  { mainlineId: 'optical', node: 'CPO', code: '300570', name: '太辰光', thesis: 'MPO/MT 插芯与 FAU，CPO 结构变化的直接受益环节，需核送样→量产状态' },
  { mainlineId: 'optical', node: 'CPO', code: '300548', name: '博创科技', thesis: '硅光与 CPO 相关光器件，需核订单真实性' },
  { mainlineId: 'optical', node: 'FAU/AWG', code: '300570', name: '太辰光', thesis: 'FAU 环节，与 CPO 节点重叠，需在建档时确定归属' },
  { mainlineId: 'optical', node: '光纤', code: '601869', name: '长飞光纤', thesis: '光纤光缆龙头，周期属性强，需与 AI 需求分离' },
  { mainlineId: 'optical', node: '光纤', code: '600487', name: '亨通光电', thesis: '光纤与海缆，AI 归因难度高，须做主线收入穿透' },
  { mainlineId: 'optical', node: '高速连接', code: '002130', name: '沃尔核材', thesis: '高速线缆，224G 铜连接方案，需核数据中心收入占比' },
  { mainlineId: 'optical', node: '高速连接', code: '300913', name: '兆龙互连', thesis: '高速数据缆，需核 AI 服务器客户' },

  // ── 半导体国产替代（3个无覆盖节点） ──
  { mainlineId: 'semi', node: '清洗', code: '603690', name: '至纯科技', thesis: '湿法清洗设备，需核在手订单与验收节奏' },
  { mainlineId: 'semi', node: '清洗', code: '688037', name: '芯源微', thesis: '涂胶显影与清洗，需核清洗业务独立占比' },
  { mainlineId: 'semi', node: '材料', code: '300054', name: '鼎龙股份', thesis: 'CMP 抛光垫与光刻胶材料，国产替代率是关键变量' },
  { mainlineId: 'semi', node: '材料', code: '688019', name: '安集科技', thesis: '抛光液，客户集中度高，需核单客户依赖' },
  { mainlineId: 'semi', node: '零部件', code: '688409', name: '富创精密', thesis: '半导体设备零部件，与设备厂资本开支同步，需核毛利结构' },
  { mainlineId: 'semi', node: '零部件', code: '688596', name: '正帆科技', thesis: '气体与零部件系统，需核半导体收入占比' },

  // ── AI电力基础设施（4个无覆盖节点） ──
  { mainlineId: 'power', node: '变压器', code: '688676', name: '金盘科技', thesis: '干式变压器，数据中心与海外订单，需核在手订单口径' },
  { mainlineId: 'power', node: '变压器', code: '301291', name: '明阳电气', thesis: '变压器与成套设备，需核数据中心收入是否已独立披露' },
  { mainlineId: 'power', node: '配电', code: '002706', name: '良信股份', thesis: '低压电器，数据中心配电，需核 AIDC 收入占比' },
  { mainlineId: 'power', node: '配电', code: '601567', name: '三星医疗', thesis: '配用电与智能电表，AI 归因需谨慎' },
  { mainlineId: 'power', node: 'UPS', code: '002335', name: '科华数据', thesis: '数据中心 UPS 与 IDC 运营，需分离设备与运营收入' },
  { mainlineId: 'power', node: 'UPS', code: '002518', name: '科士达', thesis: 'UPS 与储能，需核数据中心业务增速' },
  { mainlineId: 'power', node: '储能', code: '300274', name: '阳光电源', thesis: '储能系统与逆变器，体量大，AI 相关性需严格穿透' },
  { mainlineId: 'power', node: '储能', code: '605117', name: '德业股份', thesis: '储能逆变器，海外户储为主，与 AI 电力关联度待核' },
]

/** 去重后的研究标的代码 */
export function researchCodes(): string[] {
  return [...new Set(NODE_CANDIDATES.map(c => c.code))]
}
