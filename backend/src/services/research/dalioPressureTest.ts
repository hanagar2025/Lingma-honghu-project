/**
 * 研究层 · T-01 鸿鹄·达利欧反向压力测试
 *
 * 这一层不生产动作。
 * 这一层不改规则。
 * 这一层不增加指标。
 * 这一层不进入证据链。
 * 这一层不设计 V5。
 * 这一层不加分散投资模块。
 *
 * 达利欧真正给鸿鹄的启示，不是「要分散」，
 * 而是：不要让一个未经验证的宏观判断，拥有摧毁整个组合的权力。
 *
 * 这和已经冻结的 V4.x 高度一致。
 * 所以这里只增加一条审查纪律，不改 V4.x 代码。
 *
 * 只问：
 *
 * 如果这个判断是真的，它首先应该改变鸿鹄的哪一根轴？
 *
 * 以及这场压力测试：
 *
 * 如果我们今天判断「AI已经阶段性见顶」，
 * 鸿鹄能不能阻止我们仅凭这个宏观判断，把优质核心资产直接卖掉？
 */

const TIER = 'OBSERVATION' as const
const UNVERIFIED = 'UNVERIFIED'

export type DalioPressureTestView = {
  id: 'T-01'
  title: '鸿鹄·达利欧反向压力测试'
  tier: typeof TIER
  phase: 'V4.x Decision Validation Phase'
  frozen: true
  v5Undefined: true
  oneQuestion: string
  whatThisIs: readonly string[]
  whatThisIsNot: readonly string[]
  trueLesson: string
  isolation: {
    heading: string
    dalioChain: readonly string[]
    jumped: readonly string[]
    danger: string
    honghuMap: string
    cannotSkip: readonly string[]
  }
  pressureQuestion: {
    heading: string
    asks: string
    answer: string
    example: {
      trueMaybe: string
      notEqual: string
      middle: readonly string[]
      ifFrontHolds: string
    }
    boundary: string
  }
  fourAxes: {
    heading: string
    why: string
    axes: readonly { axis: string; answers: string }[]
    dalioError: string
    path: readonly string[]
  }
  independence: {
    heading: string
    notStockCount: string
    realMeaning: string
    exampleNames: readonly string[]
    oneFactor: string
    shouldAsk: string
    sameThought: string
    notAModule: true
  }
  threeBooks: {
    heading: string
    alreadyExist: readonly string[]
    institutionalized: string
    illusion: string
    cases: readonly { when: string; meaning: string }[]
    allowedRecord: {
      decisionQuality: string
      evidenceOutcome: string
      capitalOutcome: string
      not: string
    }
    reverseRecord: {
      decisionQuality: string
      evidenceOutcome: string
      capitalOutcome: string
      not: string
    }
    mustAccumulate: string
  }
  macroHypotheses: readonly {
    id: string
    claim: string
    status: 'OPEN'
    place: string
    not: string
    sourceStatus: typeof UNVERIFIED
  }[]
  axisFirewall: {
    heading: string
    notANewRule: true
    onlyAsk: string
    items: readonly {
      id: string
      trigger: string
      firstAxis: string
      cannotChange: string
    }[]
  }
  hdlHypothesis: {
    id: 'H-DL'
    claim: string
    status: 'OPEN'
    place: string
    cannotConclude: string
    canConclude: string
  }
  aiPeakTest: {
    heading: string
    judgment: string
    blocked: true
    whyBlocked: readonly string[]
    ifSomeoneWritesSell: string
    meaning: string
  }
  compressed: string
  chain: readonly string[]
  comeBackInAYear: string
  forbiddenNow: readonly string[]
  nextWatch: readonly string[]
  flags: {
    dalioMeansDiversify: false
    stockCountIsIndependence: false
    factEqualsPrice: false
    macroEqualsSell: false
    aiPeakSellsCore: false
    policyFearSellsAi: false
    profitProvesJudgment: false
    lossProvesSystemError: false
    gainProvesRule: false
    thisAddsV5: false
    thisAddsDiversifyModule: false
    thisChangesV4x: false
    thisLayerIssuesOrders: false
    hypothesisEntersEvidence: false
    priceMigratesLifeline: false
    exposureChangesOwnership: false
  }
}

const FALSE = {
  dalioMeansDiversify: false,
  stockCountIsIndependence: false,
  factEqualsPrice: false,
  macroEqualsSell: false,
  aiPeakSellsCore: false,
  policyFearSellsAi: false,
  profitProvesJudgment: false,
  lossProvesSystemError: false,
  gainProvesRule: false,
  thisAddsV5: false,
  thisAddsDiversifyModule: false,
  thisChangesV4x: false,
  thisLayerIssuesOrders: false,
  hypothesisEntersEvidence: false,
  priceMigratesLifeline: false,
  exposureChangesOwnership: false,
} as const

export function buildDalioPressureTestView(): DalioPressureTestView {
  return {
    id: 'T-01',
    title: '鸿鹄·达利欧反向压力测试',
    tier: TIER,
    phase: 'V4.x Decision Validation Phase',
    frozen: true,
    v5Undefined: true,
    oneQuestion: '如果这个判断是真的，它首先应该改变鸿鹄的哪一根轴？',
    whatThisIs: [
      '反向压力测试案例。',
      '一条审查纪律。不是新功能，不是新指标，不是新规则。',
      '用来审问：即使宏观判断完全正确，资本动作仍然可能是错的吗？',
    ],
    whatThisIsNot: [
      '不是分散投资模块。',
      '不是 V5。',
      '不改 V4.x 代码。',
      '不是战略证伪。',
      '不是直接减仓信号。',
      '不是 R4 卖出信号。',
    ],
    trueLesson:
      '达利欧真正给鸿鹄的启示，不是要分散，而是：不要让一个未经验证的宏观判断，拥有摧毁整个组合的权力。',
    isolation: {
      heading: '达利欧当年的错误，本质是战略判断和资本配置没有充分隔离',
      dalioChain: [
        '美国债务问题严重',
        '必然发生债务危机',
        '市场会下跌',
        '应该做空',
      ],
      jumped: [
        '事实',
        '解释',
        '市场结果',
      ],
      danger: '投资最危险的，就是把前面的事实直接等同于后面的价格结果。',
      honghuMap: '这正好对应已经冻结的那一句：价格不能迁生命线。',
      cannotSkip: [
        '美债风险增加',
        '长端利率上升',
        'AI融资模式存在风险',
        'AI硬件估值已经很高',
        '所以AI股票今天应该卖',
      ],
    },
    pressureQuestion: {
      heading: '所以达利欧应该成为鸿鹄的一个反向压力测试案例',
      asks: '即使我的宏观判断完全正确，我的资本动作仍然可能是错的吗？',
      answer: '完全可能。',
      example: {
        trueMaybe: 'AI资本开支最终确实会放缓。',
        notEqual: '不等于：今天应该卖中际旭创。',
        middle: [
          'AI需求',
          '算力建设',
          '光互联需求',
          '公司订单',
          '利润兑现',
          '市场预期',
          '当前估值',
        ],
        ifFrontHolds:
          '如果前面五项仍然强化，而只有宏观估值担忧增加，鸿鹄不能因为一个宏观观点就把优质公司的 Ownership 从核心改成退出。',
      },
      boundary: '这就是战略判断的边界。',
    },
    fourAxes: {
      heading: '这也解释了我们为什么一定要坚持四轴',
      why: '宏观判断不能直接跳到 Action。',
      axes: [
        { axis: 'Ownership', answers: '我为什么应该拥有它？' },
        { axis: 'Evidence', answers: '这个理由有没有被事实强化？' },
        { axis: 'Exposure', answers: '我应该给多少资本？' },
        { axis: 'Action', answers: '今天资本是否应该移动？' },
      ],
      dalioError: '达利欧的错误恰恰提醒我们：宏观判断不能直接跳到 Action。',
      path: [
        '战略环境 / 风险认知',
        '哪些资产的盈利逻辑因此受到影响？',
        '影响的是 Ownership，还是 Exposure？',
        '最后才可能产生 Action',
      ],
    },
    independence: {
      heading: '分散也不能被简单理解成股票越多越安全',
      notStockCount: '真正有效的是：风险来源的分散，而不是股票数量的分散。',
      realMeaning: '这些仓位到底暴露在多少个独立的因果链上？',
      exampleNames: [
        '中际旭创',
        '新易盛',
        '光迅',
        '天孚通信',
        '沪电',
        '生益科技',
      ],
      oneFactor: '看起来六只股票。实际上可能都是：AI CapEx → 光通信需求。这不是六个独立风险。而是一个巨大风险因子。',
      shouldAsk: '这些仓位到底暴露在多少个独立的因果链上？',
      sameThought: '这和已经确立的独立证据族是同一个思想。表面数量不等于独立性。这六只里有的已经在主线里，也不因此变成六个独立风险。本层不新增任何标的进 MAINLINES。',
      notAModule: true,
    },
    threeBooks: {
      heading: '达利欧最值得鸿鹄学习的，是错误必须留下来',
      alreadyExist: [
        'Decision Quality',
        'Evidence Outcome',
        'Capital Outcome',
      ],
      institutionalized:
        'V4.x 已经把达利欧的「犯错 → 记录 → 反思 → 建立原则」制度化了。这里不新开第四本账。',
      illusion: '要防止一种非常常见的投资幻觉：我赚了，所以我的判断是对的。完全错误。',
      cases: [
        { when: '判断错误 + 运气好 = 赚钱', meaning: '不能证明规则。' },
        { when: '判断正确 + 时间不对 = 亏钱', meaning: '不能证明规则。' },
      ],
      allowedRecord: {
        decisionQuality: '合规',
        evidenceOutcome: '失败',
        capitalOutcome: '亏损',
        not: '而不是自动把它标成：系统错误。',
      },
      reverseRecord: {
        decisionQuality: '合规',
        evidenceOutcome: '兑现',
        capitalOutcome: '上涨',
        not: '也不能证明：这套规则已经被验证。',
      },
      mustAccumulate: '必须积累同类样本。',
    },
    macroHypotheses: [
      {
        id: 'MH-01',
        claim: '美债风险增加',
        status: 'OPEN',
        place: '宏观假设。待验证。',
        not: '不是卖出令。',
        sourceStatus: UNVERIFIED,
      },
      {
        id: 'MH-02',
        claim: '长端利率上升',
        status: 'OPEN',
        place: '宏观假设。待验证。',
        not: '不是卖出令。',
        sourceStatus: UNVERIFIED,
      },
      {
        id: 'MH-03',
        claim: 'AI融资模式存在风险',
        status: 'OPEN',
        place: '对接 F-01 / H-FQ。融资质量必须接受审查，仍是待验证。',
        not: '不是卖出令。',
        sourceStatus: UNVERIFIED,
      },
      {
        id: 'MH-04',
        claim: 'AI硬件估值已经很高',
        status: 'OPEN',
        place: '宏观 / 估值担忧。待验证。',
        not: '不是卖出令。便宜也不是 Capital Permission。',
        sourceStatus: UNVERIFIED,
      },
      {
        id: 'MH-05',
        claim: '国家可能不希望AI股票继续吸走大量资金',
        status: 'OPEN',
        place: 'Macro Hypothesis：待验证。这个想法可以保留，甚至值得长期观察。',
        not: '不是 Risk → Sell AI。目前缺少直接证据证明国家正在主动限制 AI 二级市场资本红利。',
        sourceStatus: UNVERIFIED,
      },
      {
        id: 'MH-06',
        claim: 'AI已经阶段性见顶',
        status: 'OPEN',
        place: '本层压力测试用的宏观判断。待验证。',
        not: '不能仅凭这一句把优质核心资产直接卖掉。',
        sourceStatus: UNVERIFIED,
      },
    ],
    axisFirewall: {
      heading: '以后分析任何重大宏观判断时，只问这一句',
      notANewRule: true,
      onlyAsk: '如果这个判断是真的，它首先应该改变鸿鹄的哪一根轴？',
      items: [
        {
          id: 'A',
          trigger: '宏观风险增加',
          firstAxis: '不一定改变 Ownership。可能首先改变 Exposure。',
          cannotChange: '不能直接跳到 Action。',
        },
        {
          id: 'B',
          trigger: '公司订单下降',
          firstAxis: '可能改变 Evidence，进而影响 Action。',
          cannotChange: '仍须经过 Ownership 与 Capital Permission。',
        },
        {
          id: 'C',
          trigger: '核心竞争优势消失',
          firstAxis: '直接冲击 Ownership。',
          cannotChange: '这才可能走到价值退出。不是宏观观点。',
        },
        {
          id: 'D',
          trigger: '仓位超过硬上限',
          firstAxis: '只改变 Exposure / Action。',
          cannotChange: '不能改变 Ownership。现有 L1 / L2 已能产生核心 + 超限 + 降暴露。',
        },
        {
          id: 'E',
          trigger: '股价暴涨',
          firstAxis: '什么都不自动改变。',
          cannotChange: '价格不能迁生命线。',
        },
      ],
    },
    hdlHypothesis: {
      id: 'H-DL',
      claim: '不要让一个未经验证的宏观判断，拥有摧毁整个组合的权力',
      status: 'OPEN',
      place: '审查纪律。不是交易信号。不进证据链。不进看台必须处理。',
      cannotConclude: '不能因为相信一个大判断，就允许这个判断直接指挥资本。',
      canConclude:
        '宏观假设必须经过可验证事实、对具体公司的影响，再进入 Ownership → Evidence → Capital Permission → Exposure → Action。而且最后还要留下：一年后回来审问。',
    },
    aiPeakTest: {
      heading: '这场压力测试问的就是 V4.x 的防错机制',
      judgment: '如果我们今天判断「AI已经阶段性见顶」',
      blocked: true,
      whyBlocked: [
        '宏观判断不能直接跳到 Action。',
        '前面五项（需求、建设、光互联、订单、利润）如果仍然强化，Ownership 不得从核心改成退出。',
        'R4 不能产生卖出。',
        '价格不能迁生命线。',
        '本层不发令。H-DL 不进证据链。',
      ],
      ifSomeoneWritesSell:
        '如果有人把「AI见顶」直接写成卖出令，那是绕过 V4.x，不是 V4.x 失效。',
      meaning:
        '如果鸿鹄能阻止仅凭这个宏观判断把优质核心资产直接卖掉，V4.x 的防错机制才算真正经得住考验。本层的结论是：现有四轴、三本账、独立证据族和生命线隔离已经够用。不需要为此设计 V5，也不需要加一个分散投资模块。',
    },
    compressed:
      '不要因为你相信一个大判断，就允许这个判断直接指挥资本。',
    chain: [
      '宏观假设',
      '可验证事实',
      '对具体公司的影响',
      'Ownership',
      'Evidence',
      'Capital Permission',
      'Exposure',
      'Action',
    ],
    comeBackInAYear: '一年后回来审问。',
    forbiddenNow: [
      '不得把达利欧写成要分散。',
      '不得把股票数量写成独立性。',
      '不得把事实直接写成价格结果。',
      '不得把宏观判断直接写成卖出。',
      '不得把「AI已经阶段性见顶」写成卖中际。',
      '不得把「国家可能不希望AI吸走资金」写成 Risk → Sell AI。',
      '不得把赚钱写成判断正确。',
      '不得把亏损写成系统错误。',
      '不得把兑现写成规则已被验证。',
      '不得设计 V5。',
      '不得增加分散投资模块。',
      '不得改 V4.x。',
      '不得把 H-DL 写进证据链。',
      '本层不发令。',
    ],
    nextWatch: [
      '任何重大宏观判断先问：它首先改变哪一根轴。',
      '美债、利率、融资质量、估值、政策，全部先当假设。',
      'F-01 仍然只是待验证的融资质量观察，不是卖出令。',
      '持仓问的是独立因果链的条数，不是股票只数。',
      '三本账继续分开记。一年后回来审问。',
      '如果有人写出「AI见顶所以卖核心」，系统必须拦住。',
    ],
    flags: { ...FALSE },
  }
}

export function renderDalioPressureTest(): string {
  const v = buildDalioPressureTestView()
  const W = 122
  const L: string[] = ['', '═'.repeat(W), `${v.id}｜${v.title}`, '═'.repeat(W)]
  L.push('  本区不打分、不排序、不产生候选、不产生动作。证据等级恒为 OBSERVATION。')
  L.push('  不设计 V5。不加分散投资模块。不改 V4.x。')
  L.push(`  ${v.oneQuestion}`)
  L.push(`  ${v.trueLesson}`)
  L.push(`  ${v.hdlHypothesis.id}｜${v.hdlHypothesis.claim}　${v.hdlHypothesis.status}`)
  L.push(`  ${v.hdlHypothesis.place}`)
  L.push('')
  L.push(`  ── ${v.isolation.heading} ──`)
  L.push(`  ${v.isolation.dalioChain.join(' → ')}`)
  L.push(`  至少跳了：${v.isolation.jumped.join(' → ')}`)
  L.push(`  ${v.isolation.danger}`)
  L.push(`  ${v.isolation.honghuMap}`)
  L.push(`  即使判断：${v.isolation.cannotSkip.slice(0, 4).join('；')}`)
  L.push(`  也不能直接推出：${v.isolation.cannotSkip[4]}`)
  L.push('  中间必须经过 Evidence → Ownership → Capital Permission → Exposure → Action。')
  L.push('')
  L.push(`  ── ${v.pressureQuestion.heading} ──`)
  L.push(`  ${v.pressureQuestion.asks}`)
  L.push(`  ${v.pressureQuestion.answer}`)
  L.push(`  ${v.pressureQuestion.example.trueMaybe}`)
  L.push(`  ${v.pressureQuestion.example.notEqual}`)
  L.push(`  中间还有：${v.pressureQuestion.example.middle.join(' → ')}`)
  L.push(`  ${v.pressureQuestion.example.ifFrontHolds}`)
  L.push(`  ${v.pressureQuestion.boundary}`)
  L.push('')
  L.push(`  ── ${v.fourAxes.heading} ──`)
  L.push(`  ${v.fourAxes.why}`)
  for (const a of v.fourAxes.axes) L.push(`  ${a.axis}　${a.answers}`)
  L.push(`  ${v.fourAxes.dalioError}`)
  L.push(`  「美国债务危险」最多首先改变：${v.fourAxes.path.join(' → ')}`)
  L.push('')
  L.push(`  ── ${v.independence.heading} ──`)
  L.push(`  ${v.independence.notStockCount}`)
  L.push(`  ${v.independence.exampleNames.join(' / ')}`)
  L.push(`  ${v.independence.oneFactor}`)
  L.push(`  ${v.independence.shouldAsk}`)
  L.push(`  ${v.independence.sameThought}`)
  L.push('')
  L.push(`  ── ${v.threeBooks.heading} ──`)
  L.push(`  已有三本账：${v.threeBooks.alreadyExist.join(' / ')}`)
  L.push(`  ${v.threeBooks.institutionalized}`)
  L.push(`  ${v.threeBooks.illusion}`)
  for (const c of v.threeBooks.cases) L.push(`  ${c.when}　${c.meaning}`)
  L.push(`  允许记录：Decision Quality ${v.threeBooks.allowedRecord.decisionQuality}；Evidence Outcome ${v.threeBooks.allowedRecord.evidenceOutcome}；Capital Outcome ${v.threeBooks.allowedRecord.capitalOutcome}`)
  L.push(`  ${v.threeBooks.allowedRecord.not}`)
  L.push(`  反过来：Decision Quality ${v.threeBooks.reverseRecord.decisionQuality}；Evidence Outcome ${v.threeBooks.reverseRecord.evidenceOutcome}；Capital Outcome ${v.threeBooks.reverseRecord.capitalOutcome}`)
  L.push(`  ${v.threeBooks.reverseRecord.not}`)
  L.push(`  ${v.threeBooks.mustAccumulate}`)
  L.push('')
  L.push('  ── 宏观判断是假设，不是交易信号 ──')
  for (const h of v.macroHypotheses) {
    L.push(`  ${h.id}　${h.claim}　${h.status}　${h.sourceStatus}`)
    L.push(`      ${h.place}`)
    L.push(`      ${h.not}`)
  }
  L.push('')
  L.push(`  ── ${v.axisFirewall.heading} ──`)
  L.push(`  ${v.axisFirewall.onlyAsk}`)
  L.push('  这五条是鸿鹄的防火墙。不是新规则。')
  for (const it of v.axisFirewall.items) {
    L.push(`  ${it.id}. ${it.trigger}　首先：${it.firstAxis}`)
    L.push(`      ${it.cannotChange}`)
  }
  L.push('')
  L.push(`  ── ${v.aiPeakTest.heading} ──`)
  L.push(`  ${v.aiPeakTest.judgment}`)
  L.push('  鸿鹄必须拦住：仅凭这个宏观判断把优质核心资产直接卖掉。')
  for (const w of v.aiPeakTest.whyBlocked) L.push(`  · ${w}`)
  L.push(`  ${v.aiPeakTest.ifSomeoneWritesSell}`)
  L.push(`  ${v.aiPeakTest.meaning}`)
  L.push('')
  L.push(`  ${v.compressed}`)
  L.push(`  ${v.chain.join(' → ')}`)
  L.push(`  ${v.comeBackInAYear}`)
  L.push('')
  L.push(`  ${v.hdlHypothesis.cannotConclude}`)
  L.push(`  ${v.hdlHypothesis.canConclude}`)
  L.push('')
  L.push('  ── 现在禁止写成 ──')
  for (const x of v.forbiddenNow) L.push(`  · ${x}`)
  L.push('')
  L.push('  ── 下一步只观察 ──')
  for (const x of v.nextWatch) L.push(`  · ${x}`)
  L.push('')
  return L.join('\n')
}
