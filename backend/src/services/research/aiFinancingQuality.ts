/**
 * 研究层 · F-01 鸿鹄·AI融资质量观察
 *
 * 这一层不生产动作。
 * 这一层不改规则。
 * 这一层不增加指标。
 * 这一层不进入证据链。
 *
 * 它只记录一个观察问题：
 *
 * AI 资本开支的融资质量正在恶化吗？
 *
 * 真正值得警惕的，不是科技公司发债很多，
 * 也不是简单的折旧会让利润虚高，而是：
 *
 * AI 资本开支正在从企业用自己的现金押注未来，
 * 逐渐变成整个金融体系共同为 AI 未来现金流下注。
 *
 * 它可能成为新的宏观 / 产业风险背景变量。
 * 目前还不能直接变成卖出理由。
 *
 * 它不是战略证伪。
 * 它不是直接减仓信号。
 * 它甚至暂时不是 R4 卖出信号。
 *
 * 它应该进入：
 *
 * AI 主线风险背景：融资质量恶化 → 待验证
 */

const TIER = 'OBSERVATION' as const;
const PUBLIC_NOT_YET_WIRED = 'PUBLIC_NOT_YET_WIRED';
const UNVERIFIED = 'UNVERIFIED';

export type FinancingQualityView = {
  id: 'F-01';
  title: '鸿鹄·AI融资质量观察';
  tier: typeof TIER;
  phase: 'V4.x Decision Validation Phase';
  frozen: true;
  v5Undefined: true;
  oneQuestion: string;
  whatThisIs: string[];
  whatThisIsNot: string[];
  trueAlert: string;
  firstJudgment: {
    heading: string;
    bondIssuance: {
      claim: string;
      verdict: string;
      committeeNotes: readonly string[];
      sourceStatus: typeof PUBLIC_NOT_YET_WIRED;
      conclusion: string;
    };
    debtIsNotDanger: {
      claim: string;
      verdict: string;
      whyWrong: readonly string[];
      realQuestion: string;
    };
    depreciationLag: {
      claim: string;
      verdict: string;
      chanosPoint: string;
      qualifier: string;
      realDangers: readonly string[];
    };
  };
  auditChain: {
    heading: string;
    note: string;
    steps: readonly string[];
    ifRunsThrough: string;
    ifBreaks: string;
    notANewMetric: true;
  };
  assetLife: {
    heading: string;
    deeperThanLag: string;
    accountingPath: string;
    economicPath: string;
    danger: string;
    whyHardware: string;
  };
  depreciationClock: {
    heading: string;
    notANewIndicator: true;
    times: readonly { id: string; label: string }[];
    readings: readonly { when: string; meaning: string }[];
    sourceStatus: typeof UNVERIFIED;
  };
  fiveLayers: {
    heading: string;
    stopSimple: string;
    layers: readonly { id: string; title: string; question: string }[];
    notABuyList: true;
  };
  holdingRechecks: readonly {
    name: string;
    inMainlines: boolean;
    coreRiskIsNot: string;
    shouldAsk: readonly string[];
    ifStrengthens: string;
    ifWeakens: string;
    r4Note: string;
  }[];
  observationTable: readonly {
    item: string;
    state: string;
    sourceStatus: typeof UNVERIFIED;
  }[];
  whyNotPeRsiMa: readonly string[];
  hfqHypothesis: {
    id: 'H-FQ';
    claim: string;
    status: 'OPEN';
    place: string;
    cannotConclude: string;
    canConclude: string;
    nowAsk: string;
    oldAsk: string;
  };
  futureChains: {
    heading: string;
    neitherIsAnOrder: true;
    riskChain: {
      title: string;
      steps: readonly string[];
      meaning: string;
    };
    productiveChain: {
      title: string;
      steps: readonly string[];
      meaning: string;
    };
  };
  forbiddenNow: readonly string[];
  nextWatch: readonly string[];
  flags: {
    debtIsBubble: false;
    debtIsDanger: false;
    megaTechEqualsGpuLessor: false;
    chanosEqualsFraud: false;
    lagEqualsSell: false;
    unifiedAiBubble: false;
    thisIsR4Sell: false;
    thisIsStrategyFalsify: false;
    thisLayerIssuesOrders: false;
    addV5DebtMetric: false;
    hypothesisEntersEvidence: false;
    peRsiMaAnswersThis: false;
    capexRiseMeansBuyUpstream: false;
  };
};

const FALSE = {
  debtIsBubble: false,
  debtIsDanger: false,
  megaTechEqualsGpuLessor: false,
  chanosEqualsFraud: false,
  lagEqualsSell: false,
  unifiedAiBubble: false,
  thisIsR4Sell: false,
  thisIsStrategyFalsify: false,
  thisLayerIssuesOrders: false,
  addV5DebtMetric: false,
  hypothesisEntersEvidence: false,
  peRsiMaAnswersThis: false,
  capexRiseMeansBuyUpstream: false,
} as const;

export function buildAiFinancingQualityView(): FinancingQualityView {
  return {
    id: 'F-01',
    title: '鸿鹄·AI融资质量观察',
    tier: TIER,
    phase: 'V4.x Decision Validation Phase',
    frozen: true,
    v5Undefined: true,
    oneQuestion: 'AI资本开支的融资质量正在恶化吗？',
    whatThisIs: [
      '宏观 / 产业风险背景变量。',
      '只用已有财务数据重新串起来的观察。',
      '待验证的研究问题，不是动作。',
    ],
    whatThisIsNot: [
      '不是战略证伪。',
      '不是直接减仓信号。',
      '甚至暂时不是 R4 卖出信号。',
      '不是 V5，不增加 AI 债务指标。',
      '冻结期不能偷偷加功能。',
    ],
    trueAlert:
      'AI资本开支正在从企业用自己的现金押注未来，逐渐变成整个金融体系共同为AI未来现金流下注。',
    firstJudgment: {
      heading: '视频说的三件事，有真有假',
      bondIssuance: {
        claim: '科技巨头大量发债',
        verdict: '事实，而且正在加速。这不是阴谋论。',
        committeeNotes: [
          '委员会转述 Reuters 2026-08-21：2026年美国科技公司AI相关债务发行已约2200亿美元，远高于2025年的125亿美元。',
          '委员会转述：科技公司债券相对普通投资级债券的利差约扩大到89bp。',
          '委员会转述：Alphabet、Amazon、Meta、Oracle 等大型科技公司都在利用债券市场为AI基础设施融资。',
          '委员会转述 FactSet：hyperscalers 的AI资本开支开始明显超过自身现金流承受能力，因此越来越依赖外部融资。',
          '委员会转述：Google 今年资本开支指引已提高到1950亿—2050亿美元，远高于2025年的水平。',
        ],
        sourceStatus: PUBLIC_NOT_YET_WIRED,
        conclusion: 'AI产业现在已经不仅是科技投资周期，而正在变成一个信用周期。',
      },
      debtIsNotDanger: {
        claim: '发债等于危险',
        verdict: '这个推论不成立。',
        whyWrong: [
          'Alphabet 和 Microsoft 这种公司发债，和 CoreWeave、Oracle 某些高杠杆AI项目发债，完全不是一个风险等级。',
          '一个拥有巨大广告现金流、云业务现金流和现金储备的公司借钱建设数据中心，和一个自身自由现金流很差、依靠外部融资买GPU再租出去赚钱的公司，经济模型完全不同。',
          '不能看到 AI发债上升，就直接写成 AI泡沫。',
        ],
        realQuestion: '债务增长速度有没有超过AI资产产生现金流的速度？这才是鸿鹄应该记录的东西。',
      },
      depreciationLag: {
        claim: 'CapEx 到折旧到 ROIC 的滞后',
        verdict: 'Jim Chanos 的观点值得认真听，但不能直接照单全收。',
        chanosPoint:
          'AI公司现在疯狂购买GPU、服务器和数据中心，但其中大量资产处于建设 / 安装阶段，尚未正式投入使用，因此暂时没有进入折旧费用。今天利润表看起来很好，不代表未来利润也一样好。GPU从采购到正式部署可能存在较长时间差，导致折旧确认滞后。这个逻辑是成立的。',
        qualifier:
          '这不等于会计造假。只要资产确实尚未达到可使用状态，资本化、暂缓折旧本身就是正常会计处理。',
        realDangers: [
          '资产什么时候开始产生收入？',
          '它的经济寿命到底有多长？',
        ],
      },
    },
    auditChain: {
      heading: '不是增加指标，而是把现有数据重新串起来',
      note: '冻结期不能偷偷加功能。所以不会说 V5 增加 AI 债务指标。',
      steps: [
        'CapEx',
        '资产投入',
        '折旧开始',
        '收入增长',
        '毛利',
        '经营现金流',
        '自由现金流',
        'ROIC',
      ],
      ifRunsThrough: '这条链如果能够跑通：AI资本开支是生产性投资。',
      ifBreaks: '如果跑不通：AI资本开支开始变成资产负债表上的未来承诺。',
      notANewMetric: true,
    },
    assetLife: {
      heading: '最值得警惕的其实不是GPU价格，而是资产寿命',
      deeperThanLag: '这比视频说的折旧滞后还深一层。',
      accountingPath: '一台GPU服务器100元资本开支。会计上5年折旧，每年20元。账面：100 → 80 → 60 → 40。',
      economicPath: '如果技术迭代导致2年以后这台机器经济价值只剩40元。经济价值：100 → 70 → 40 → 20。',
      danger: '这就是经济折旧大于会计折旧。这才是真正危险的地方。',
      whyHardware: '因为AI硬件不是普通厂房。它的技术迭代速度极快。',
    },
    depreciationClock: {
      heading: '所以我们真正要盯的是折旧时钟',
      notANewIndicator: true,
      times: [
        { id: 't1', label: 'CapEx发生时间' },
        { id: 't2', label: '资产投入使用时间' },
        { id: 't3', label: '折旧开始时间' },
        { id: 't4', label: '收入 / 现金流兑现时间' },
      ],
      readings: [
        { when: '兑现明显早于经济折旧压力', meaning: '很好。' },
        { when: '兑现跟不上折旧开始', meaning: '开始危险。' },
        {
          when: '兑现明显落后于折旧开始，同时还继续大举借债扩大CapEx',
          meaning: '这才是真正的风险信号。',
        },
      ],
      sourceStatus: UNVERIFIED,
    },
    fiveLayers: {
      heading: '这会直接改变我们对AI产业链的理解',
      stopSimple: '答案不能再简单看：AI需求上升 → 上游订单上升 → 股票上升。',
      layers: [
        { id: 'L1', title: '需求', question: 'AI应用有没有真实需求？' },
        { id: 'L2', title: 'CapEx', question: 'Google / Microsoft / Meta / Amazon 还愿不愿意继续花钱？' },
        { id: 'L3', title: '融资', question: '这些CapEx是现金流支付，还是越来越依赖债务？' },
        { id: 'L4', title: '资产效率', question: '买来的GPU、服务器、网络设备：收入 / 现金流能不能覆盖资本成本？' },
        { id: 'L5', title: '折旧', question: '旧一代设备的经济价值下降速度有没有超过会计折旧？' },
      ],
      notABuyList: true,
    },
    holdingRechecks: [
      {
        name: '中际旭创 / 新易盛',
        inMainlines: true,
        coreRiskIsNot: '核心风险不是：AI发债了。',
        shouldAsk: [
          '下游CapEx是否继续兑现',
          '光通信需求是否继续增长',
          'ASP / 毛利是否保持',
          '客户资本开支是否持续',
        ],
        ifStrengthens: '如果这些继续强化：AI债务增加反而意味着客户仍在疯狂建设。所以短期甚至可能是利好。',
        ifWeakens: '如果下游CapEx停、需求停、ASP掉：那才是这条链自己的证据，不是统一的AI泡沫标签。',
        r4Note: 'R4 不能产生卖出。本层也不发令。',
      },
      {
        name: '海光信息',
        inMainlines: true,
        coreRiskIsNot: '核心风险不是统一的AI泡沫，而是利润增长和现金流之间的关系。',
        shouldAsk: [
          '国产算力需求',
          'CPU / DCU出货',
          '收入',
          '利润',
          '现金回收',
        ],
        ifStrengthens: '如果收入、利润、现金流逐渐同步：反而说明AI投资正在形成真实经济活动。',
        ifWeakens: '如果CapEx、库存、应收不断扩大，而现金迟迟不回来：风险增加。',
        r4Note: 'R4 不能产生卖出。本层也不发令。现有 L1 / L2 已能产生核心 + 超限 + 降暴露。',
      },
      {
        name: '中芯国际',
        inMainlines: false,
        coreRiskIsNot: '它是整个半导体产业扩产的基础设施。AI债务不是它的核心风险。',
        shouldAsk: [
          '产能利用率有没有继续提高？',
          'ASP有没有改善？',
          '毛利率有没有改善？',
          '新增产能是不是能被需求消化？',
        ],
        ifStrengthens: '如果这些成立：AI债务不是核心风险。',
        ifWeakens: '如果产能消化不了、ASP掉、毛利掉：那是它自己的证据。中芯不进决策域，只作观察对照。',
        r4Note: '观察对照。不新增进 MAINLINES。R4 不能产生卖出。',
      },
      {
        name: '寒武纪',
        inMainlines: false,
        coreRiskIsNot: '这个反而要更谨慎。因为它同时受到AI需求增长和AI资本开支回报率两边影响。',
        shouldAsk: [
          '未来AI资本开支是否仍然爆炸',
          '市场是否开始认为大家花了这么多钱，但是AI公司的利润 / 现金流无法覆盖资本成本',
        ],
        ifStrengthens: '如果未来AI资本开支仍然爆炸：寒武纪可能继续受益。这不是买入令。',
        ifWeakens: '如果市场开始怀疑资本成本覆盖：最先受到估值压缩的，很可能就是高预期AI芯片资产。',
        r4Note: '寒武纪的 R4 重要性明显高于中芯。R4 仍然不能产生卖出。寒武纪不进决策域。',
      },
    ],
    observationTable: [
      { item: 'Hyperscaler CapEx', state: '强化', sourceStatus: UNVERIFIED },
      { item: 'AI相关债务融资', state: '快速增加', sourceStatus: UNVERIFIED },
      { item: '融资成本', state: '上升压力', sourceStatus: UNVERIFIED },
      { item: 'AI收入兑现', state: '强化，但需持续验证', sourceStatus: UNVERIFIED },
      { item: 'FCF', state: '分化', sourceStatus: UNVERIFIED },
      { item: '资产折旧压力', state: '尚未充分验证', sourceStatus: UNVERIFIED },
      { item: 'AI资产经济寿命', state: 'UNKNOWN', sourceStatus: UNVERIFIED },
      { item: 'AI CapEx ROI', state: 'UNKNOWN', sourceStatus: UNVERIFIED },
    ],
    whyNotPeRsiMa: [
      '这段信息让我们更坚定 V4.x 的方向。',
      '如果我们以前的系统：PE高就风险，RSI高就减仓，均线破位就卖，那么面对今天这种环境，系统会非常混乱。',
      '真正的问题不是股价高不高。',
      '而是：AI资本开支是否正在从高回报生产性投资转向债务驱动的资产扩张？',
      '这是一个产业经济学问题。',
      'PE、RSI、均线答不出这个问题。',
    ],
    hfqHypothesis: {
      id: 'H-FQ',
      claim: 'AI主线风险背景：融资质量恶化 → 待验证',
      status: 'OPEN',
      place: '它应该进入观察层，持续观察。不是战略证伪，不是直接减仓信号，甚至暂时不是 R4 卖出信号。',
      cannotConclude: '所以现在不能得出 AI泡沫已经破裂。',
      canConclude:
        '但可以得出一个非常重要的宏观判断：AI投资周期已经进入融资质量和资本回报率必须接受审查的阶段。',
      nowAsk: '为了实现这些增长，整个产业链到底需要投入多少钱？这些钱是谁出的？最终谁产生现金流？现金流能不能覆盖资本成本和折旧？',
      oldAsk: '这和2023—2025年最大的区别，就是市场已经不能只问：AI还会不会增长？',
    },
    futureChains: {
      heading: '两条未来证据链。没有一个自动买卖。',
      neitherIsAnOrder: true,
      riskChain: {
        title: '边际回报下降链',
        steps: [
          '债务上升',
          'CapEx上升',
          '利息成本上升',
          'AI收入增速下降',
          'FCF下降',
          '折旧上升',
          'ROIC下降',
        ],
        meaning:
          '这时候就不是一个视频的观点了。而是一条完整的证据链开始指向：AI资本开支的边际回报正在下降。那时候，鸿鹄才有资格开始改变资本状态。',
      },
      productiveChain: {
        title: '真实基础设施投资链',
        steps: [
          '债务上升',
          'CapEx上升',
          'AI收入上升',
          '毛利稳定',
          'FCF恢复',
          'ROIC稳定 / 上升',
        ],
        meaning:
          '那么这个债务扩张反而证明：AI正在从故事进入真实基础设施投资周期。这两个结果，股票价格可能短期都很热闹，但投资结论完全相反。',
      },
    },
    forbiddenNow: [
      '不得写成 AI泡沫已经破裂。',
      '不得把发债写成统一卖出理由。',
      '不得把大科技发债和高杠杆GPU出租公司写成同一风险等级。',
      '不得把折旧滞后写成会计造假。',
      '不得把折旧时钟写成新指标。',
      '不得把五层理解写成买卖名单。',
      '不得把中芯、寒武纪新增进 MAINLINES。',
      '不得把 H-FQ 写进证据链。',
      '不得把本层写成 R4 卖出。',
      '不得把本层写成战略证伪。',
      '不得增加 V5 AI 债务指标。',
      '本层不发令。',
    ],
    nextWatch: [
      '债务增长速度有没有超过AI资产产生现金流的速度。',
      '资产什么时候开始产生收入。',
      '经济寿命到底有多长；经济折旧有没有大于会计折旧。',
      '折旧时钟四个时间有没有错位。',
      '五层：需求、CapEx、融资、资产效率、折旧。',
      '持仓各自问各自的问题，不要用统一的AI泡沫标签。',
      '两条未来证据链哪一条开始成形。成形了也不自动买卖。',
    ],
    flags: { ...FALSE },
  };
}

export function renderAiFinancingQuality(): string {
  const v = buildAiFinancingQualityView();
  const W = 122;
  const L: string[] = ['', '═'.repeat(W), `${v.id}｜${v.title}`, '═'.repeat(W)];
  L.push('  本区不打分、不排序、不产生候选、不产生动作。证据等级恒为 OBSERVATION。');
  L.push('  冻结期不能偷偷加功能。不增加 V5 AI 债务指标。');
  L.push(`  ${v.oneQuestion}`);
  L.push(`  ${v.trueAlert}`);
  L.push(`  ${v.hfqHypothesis.id}｜${v.hfqHypothesis.claim}　${v.hfqHypothesis.status}`);
  L.push(`  ${v.hfqHypothesis.place}`);
  L.push('');
  L.push(`  ── ${v.firstJudgment.heading} ──`);
  L.push(`  ① ${v.firstJudgment.bondIssuance.claim}　${v.firstJudgment.bondIssuance.verdict}`);
  for (const n of v.firstJudgment.bondIssuance.committeeNotes) L.push(`      ${n}`);
  L.push(`      来源状态：${v.firstJudgment.bondIssuance.sourceStatus}`);
  L.push(`      ${v.firstJudgment.bondIssuance.conclusion}`);
  L.push(`  ② ${v.firstJudgment.debtIsNotDanger.claim}　${v.firstJudgment.debtIsNotDanger.verdict}`);
  for (const n of v.firstJudgment.debtIsNotDanger.whyWrong) L.push(`      ${n}`);
  L.push(`      ${v.firstJudgment.debtIsNotDanger.realQuestion}`);
  L.push(`  ③ ${v.firstJudgment.depreciationLag.claim}　${v.firstJudgment.depreciationLag.verdict}`);
  L.push(`      ${v.firstJudgment.depreciationLag.chanosPoint}`);
  L.push(`      ${v.firstJudgment.depreciationLag.qualifier}`);
  for (const n of v.firstJudgment.depreciationLag.realDangers) L.push(`      ${n}`);
  L.push('');
  L.push(`  ── ${v.auditChain.heading} ──`);
  L.push(`  ${v.auditChain.note}`);
  L.push(`  ${v.auditChain.steps.join(' → ')}`);
  L.push(`  ${v.auditChain.ifRunsThrough}`);
  L.push(`  ${v.auditChain.ifBreaks}`);
  L.push('');
  L.push(`  ── ${v.assetLife.heading} ──`);
  L.push(`  ${v.assetLife.deeperThanLag}`);
  L.push(`  ${v.assetLife.accountingPath}`);
  L.push(`  ${v.assetLife.economicPath}`);
  L.push(`  ${v.assetLife.danger}`);
  L.push(`  ${v.assetLife.whyHardware}`);
  L.push('');
  L.push(`  ── ${v.depreciationClock.heading} ──`);
  L.push('  不是新指标。而是现有财务数据的组合观察。');
  for (const t of v.depreciationClock.times) L.push(`  ${t.id}　${t.label}`);
  for (const r of v.depreciationClock.readings) L.push(`  ${r.when}　→　${r.meaning}`);
  L.push(`  来源状态：${v.depreciationClock.sourceStatus}`);
  L.push('');
  L.push(`  ── ${v.fiveLayers.heading} ──`);
  L.push(`  ${v.fiveLayers.stopSimple}`);
  L.push('  五层是研究顺序，不是买卖名单。');
  for (const layer of v.fiveLayers.layers) L.push(`  ${layer.id}　${layer.title}　${layer.question}`);
  L.push('');
  L.push('  ── 对现有持仓影响完全不同。AI泡沫不是统一风险 ──');
  for (const h of v.holdingRechecks) {
    L.push(`  ${h.name}${h.inMainlines ? '' : '　观察对照，不进 MAINLINES'}`);
    L.push(`      ${h.coreRiskIsNot}`);
    for (const q of h.shouldAsk) L.push(`      问：${q}`);
    L.push(`      ${h.ifStrengthens}`);
    L.push(`      ${h.ifWeakens}`);
    L.push(`      ${h.r4Note}`);
  }
  L.push('');
  L.push('  ── 只用已有数据回答 ──');
  for (const row of v.observationTable) {
    L.push(`  ${row.item}　${row.state}　${row.sourceStatus}`);
  }
  L.push('');
  L.push('  ── 为什么拒绝 PE + RSI + 均线 ──');
  for (const x of v.whyNotPeRsiMa) L.push(`  ${x}`);
  L.push('');
  L.push(`  ${v.hfqHypothesis.cannotConclude}`);
  L.push(`  ${v.hfqHypothesis.canConclude}`);
  L.push(`  ${v.hfqHypothesis.oldAsk}`);
  L.push(`  ${v.hfqHypothesis.nowAsk}`);
  L.push('');
  L.push(`  ── ${v.futureChains.heading} ──`);
  L.push(`  ${v.futureChains.riskChain.title}：${v.futureChains.riskChain.steps.join(' → ')}`);
  L.push(`      ${v.futureChains.riskChain.meaning}`);
  L.push(`  ${v.futureChains.productiveChain.title}：${v.futureChains.productiveChain.steps.join(' → ')}`);
  L.push(`      ${v.futureChains.productiveChain.meaning}`);
  L.push('');
  L.push('  ── 现在禁止写成 ──');
  for (const x of v.forbiddenNow) L.push(`  · ${x}`);
  L.push('');
  L.push('  ── 下一步只观察 ──');
  for (const x of v.nextWatch) L.push(`  · ${x}`);
  L.push('');
  return L.join('\n');
}
