/**
 * 研究层 · A-01 鸿鹄·AI四幕与利润中心迁移观察
 *
 * 这一层不生产动作。
 * 这一层不改规则。
 * 这一层不增加指标。
 * 这一层不进入证据链。
 *
 * 视频的核心判断保留一半、修正一半。
 *
 * 真正值得重视的，不是「软件股要涨了」，而是：
 *
 * AI投资正在从「建设算力」逐渐进入「验证算力能不能产生经济回报」的阶段。
 *
 * AI主线没有结束，但资本的最优配置位置可能正在发生变化。
 *
 * 这句话目前只能叫宏观 / 产业假设，不能进入 Action。
 *
 * 不要因为这条视频减仓中际旭创。
 * 不要因为软件反弹就立即去买软件。
 * 更不要因为「第一幕→第二幕」这个故事改变鸿鹄规则。
 *
 * 不是从硬件切到软件。
 * 而是从 AI 故事切换到 AI 经济产出。
 *
 * 不追逐叙事迁移，只等待证据迁移。
 */

const TIER = 'OBSERVATION' as const
const PUBLIC_NOT_YET_WIRED = 'PUBLIC_NOT_YET_WIRED'
const UNVERIFIED = 'UNVERIFIED'

export type FourActsView = {
  id: 'A-01'
  title: '鸿鹄·AI四幕与利润中心迁移观察'
  tier: typeof TIER
  phase: 'V4.x Decision Validation Phase'
  frozen: true
  v5Undefined: true
  oneQuestion: string
  whatThisIs: readonly string[]
  whatThisIsNot: readonly string[]
  keepHalf: string
  correctHalf: string
  facts: {
    heading: string
    nvidiaEarnings: {
      claim: string
      verdict: string
      committeeNotes: readonly string[]
      sourceStatus: typeof PUBLIC_NOT_YET_WIRED
    }
    financingPlatform: {
      claim: string
      verdict: string
      committeeNotes: readonly string[]
      sourceStatus: typeof PUBLIC_NOT_YET_WIRED
      meaning: string
    }
  }
  fourActs: {
    heading: string
    directionRight: string
    acts: readonly { id: string; name: string; asks: string; whoEarns: string }[]
    oldTrade: string
    newTrade: string
    notABuyList: true
  }
  financingIsNotPoverty: {
    heading: string
    wrongRead: string
    official: string
    accurate: string
    highway: string
    newRisk: string
    mustWatch: string
    connectsTo: string
  }
  profitCenter: {
    heading: string
    notAsk: string
    realAsk: string
    earlyEvidence: readonly string[]
    sourceStatus: typeof UNVERIFIED
    dangerousThought: string
    whyWrong: string
  }
  holdingRechecks: readonly {
    name: string
    inMainlines: boolean
    band: string
    shouldAsk: readonly string[]
    ifStrengthens: string
    ifStretched: string
    r4Note: string
  }[]
  softwareBrake: {
    heading: string
    notEqual: string
    salesforceNote: string
    sourceStatus: typeof UNVERIFIED
    mustAsk: readonly string[]
    thatMeans: string
    priceLogic: string
    forbidden: string
  }
  fifthLayer: {
    heading: string
    rewrite: string
    chain: readonly string[]
    lastLayer: string
  }
  migrationHypothesis: {
    heading: string
    claim: string
    status: 'OPEN'
    cannotProve: readonly string[]
    nvidiaCounter: {
      heading: string
      ifActOneEnded: string
      fact: string
      market: string
      sourceStatus: typeof PUBLIC_NOT_YET_WIRED
      reasonable: string
      not: string
    }
  }
  openHypotheses: readonly {
    id: string
    claim: string
    status: 'OPEN'
    watch: readonly string[]
    sourceStatus: typeof UNVERIFIED
  }[]
  hpcHypothesis: {
    id: 'H-PC'
    claim: string
    status: 'OPEN'
    place: string
    cannotConclude: string
    canConclude: string
  }
  decisionNow: {
    heading: string
    doNot: readonly string[]
    should: string
    switchTo: string
    nextPool: string
    contrast: readonly { name: string; meaning: string }[]
    frozenState: string
  }
  forbiddenNow: readonly string[]
  nextWatch: readonly string[]
  flags: {
    softwareMustRise: false
    nvidiaFundamentalsBroken: false
    financingMeansClientsBroke: false
    actOneEnded: false
    actTwoIsNewChampion: false
    sellZhongjiBecauseSoftwareRose: false
    buySoftwareBecauseActTwo: false
    aiGoodMeansBuyAllHardware: false
    rotationIsCapitalPermission: false
    thisChangesV4x: false
    thisAddsV5: false
    thisLayerIssuesOrders: false
    hypothesisEntersEvidence: false
    priceMigratesLifeline: false
    stretchedSells: false
  }
}

const FALSE = {
  softwareMustRise: false,
  nvidiaFundamentalsBroken: false,
  financingMeansClientsBroke: false,
  actOneEnded: false,
  actTwoIsNewChampion: false,
  sellZhongjiBecauseSoftwareRose: false,
  buySoftwareBecauseActTwo: false,
  aiGoodMeansBuyAllHardware: false,
  rotationIsCapitalPermission: false,
  thisChangesV4x: false,
  thisAddsV5: false,
  thisLayerIssuesOrders: false,
  hypothesisEntersEvidence: false,
  priceMigratesLifeline: false,
  stretchedSells: false,
} as const

export function buildAiFourActsView(): FourActsView {
  return {
    id: 'A-01',
    title: '鸿鹄·AI四幕与利润中心迁移观察',
    tier: TIER,
    phase: 'V4.x Decision Validation Phase',
    frozen: true,
    v5Undefined: true,
    oneQuestion: '资本回报最优环节是否正在从第一幕向第二、第三幕迁移？',
    whatThisIs: [
      '研究主线迁移假设。',
      '宏观 / 产业观察。待验证。',
      '用来问：谁已经把算力变成了收入、利润和现金流。',
    ],
    whatThisIsNot: [
      '不是买卖信号。',
      '不是从硬件切到软件。',
      '不是战略证伪。',
      '不是减仓中际的理由。',
      '不是买入软件的理由。',
      '不改 V4.x。不加 V5。',
    ],
    keepHalf:
      '真正值得重视的，不是软件股要涨了，而是：AI投资正在从建设算力，逐渐进入验证算力能不能产生经济回报的阶段。',
    correctHalf:
      '第一幕没有结束。英伟达基本面没有坏。融资平台不等于客户没钱买芯片。软件反弹不能授予资本迁移资格。',
    facts: {
      heading: '先确认几个关键事实',
      nvidiaEarnings: {
        claim: '英伟达最新季度非常强',
        verdict: '所以不能把现在的情况解释成英伟达基本面坏了。',
        committeeNotes: [
          '委员会转述：最新季度营收约962亿美元，同比约+106%，毛利率约75%。',
        ],
        sourceStatus: PUBLIC_NOT_YET_WIRED,
      },
      financingPlatform: {
        claim: '英伟达联合金融机构建立AI算力基础设施融资平台',
        verdict: '这件事情比英伟达财报好不好更重要。它意味着：AI资本开支正在金融化、基础设施化。',
        committeeNotes: [
          '委员会转述：英伟达已联合 Apollo、BlackRock、Blackstone、Brookfield、Goldman Sachs、KKR 等，建立旨在调动超过5000亿美元第三方资本的AI算力基础设施融资平台。',
        ],
        sourceStatus: PUBLIC_NOT_YET_WIRED,
        meaning: 'AI算力开始从企业资本开支，向基础设施资产融资模式迁移。',
      },
    },
    fourActs: {
      heading: '所以视频说的第一幕到第二幕，方向是对的',
      directionRight: '但我会把AI产业链现在重新划成四层。四层是研究顺序，不是买卖名单。',
      acts: [
        { id: 'A1', name: '第一幕', asks: '有没有算力？', whoEarns: 'GPU、光模块、服务器、存储、电力' },
        { id: 'A2', name: '第二幕', asks: '算力能不能被有效利用？', whoEarns: '云、数据中心、网络、软件' },
        { id: 'A3', name: '第三幕', asks: 'AI能不能产生收入？', whoEarns: 'Agent、SaaS、行业软件' },
        { id: 'A4', name: '第四幕', asks: 'AI收入能否超过AI成本？', whoEarns: '真正的AI平台 / 应用龙头' },
      ],
      oldTrade: '过去两年市场主要在交易：算力稀缺 → 必须疯狂建设。',
      newTrade: '现在开始转向：建设了这么多算力 → 谁真正能把它变成现金流？这就是我们真正应该观察的变化。',
      notABuyList: true,
    },
    financingIsNotPoverty: {
      heading: '但「英伟达融资 = 客户没钱买芯片」这个解释，不同意',
      wrongRead: '5000亿美元并不是：英伟达发现客户没钱，所以英伟达借钱给客户买GPU。',
      official: '官方定义是建立独立的计算基础设施融资平台，利用第三方资本支持AI基础设施建设。',
      accurate: '更准确的理解是：AI算力开始从企业资本开支，向基础设施资产融资模式迁移。这反而可能是AI产业进入成熟阶段的表现。',
      highway: '类似：修高速公路，从政府自己出钱，变成收费公路基础设施资产，金融资本参与。',
      newRisk: '但是这里同时产生了一个新的风险：如果AI算力未来产生不了足够现金流，金融杠杆会把问题放大。',
      mustWatch: '所以以后不能只看GPU卖了多少。必须开始看：GPU产生了多少真实收入和自由现金流。',
      connectsTo: '这恰好与已经强调的盈利兑现完全一致。也对接 F-01：融资质量必须接受审查。',
    },
    profitCenter: {
      heading: '真正值得关注的是钱往哪里迁移',
      notAsk: '现在最重要的不是：AI结束了吗？',
      realAsk: '而是：AI产业链利润中心是否开始迁移？',
      earlyEvidence: [
        '委员会转述：最近软件板块出现明显反弹，Salesforce、CrowdStrike 等公司在最新财报后大涨，软件ETF也出现明显上涨。',
        '英伟达、半导体这些第一幕资产并不是基本面变坏，而是市场开始要求更高的预期兑现。',
      ],
      sourceStatus: UNVERIFIED,
      dangerousThought: '应该警惕一个非常危险的认知：AI还很好，所以继续买所有AI硬件。这是错误的。',
      whyWrong: 'AI行业很好，不代表产业链所有环节的资本回报率都一样。',
    },
    holdingRechecks: [
      {
        name: '中际旭创 / 新易盛',
        inMainlines: true,
        band: '继续验证',
        shouldAsk: [
          '订单',
          '出货',
          'ASP',
          '毛利率',
          '海外客户CapEx',
          '自由现金流',
        ],
        ifStrengthens: '如果这些继续强化：Ownership不变。不会因为软件开始涨，就说中际旭创该卖了。完全没有这个依据。',
        ifStretched: '如果收入继续增长，利润增速下降，毛利率下降，市场预期仍然很高：才会进入已定义的 R4，Price-implied growth 大于 Evidence-supported growth，也就是 STRETCHED。',
        r4Note: 'STRETCHED 只停新资本。R4 不能产生卖出。本层也不发令。',
      },
      {
        name: '浪潮信息',
        inMainlines: false,
        band: '观察对照',
        shouldAsk: [
          '算力需求还能增长多少',
          '公司利润还能增长多少',
          '估值有没有把增长提前透支',
        ],
        ifStrengthens: '逻辑已经从「算力爆发所以买」变成兑现问题。浪潮不新增进 MAINLINES。',
        ifStretched: '即使透支，也只可能是 R4 / STRETCHED，不是卖出令。',
        r4Note: '观察对照。不进决策域。R4 不能产生卖出。',
      },
      {
        name: '中科曙光',
        inMainlines: true,
        band: '继续验证',
        shouldAsk: [
          '系统集成订单',
          '出货',
          '利润兑现',
          '自由现金流',
        ],
        ifStrengthens: '它是研究席位上的第一幕系统集成。主线盈利如果仍强，继续验证。',
        ifStretched: '估值透支只停新资本，不改 Ownership。',
        r4Note: 'R4 不能产生卖出。本层也不发令。',
      },
      {
        name: '软件 / Salesforce / CrowdStrike',
        inMainlines: false,
        band: '没有资本迁移资格',
        shouldAsk: [
          'AI产品ARR',
          '客户数量',
          '付费率',
          'ARPU',
          '续费',
          '毛利',
          'FCF',
        ],
        ifStrengthens: '只有这些进入财报，才叫：算力 → 软件 → 收入 → 利润。才有资格进入下一轮候选池，不是现在建仓。',
        ifStretched: '板块上涨、芯片涨多了软件跌多了所以轮动：那是价格逻辑。价格不能迁生命线。',
        r4Note: '软件不能因为第二幕三个字就买。不新增进 MAINLINES。',
      },
      {
        name: '兆易创新',
        inMainlines: true,
        band: '重新审查',
        shouldAsk: [
          '基本面是否突然强化',
          '回购是否强化',
        ],
        ifStrengthens: '对照：兆易是基本面突然强化加回购强化，所以重新审查。不是软件轮动。',
        ifStretched: '战略资格已经否决过。重新审查不等于自动买回。',
        r4Note: 'C 级清退仍在。本层不改战略资格。',
      },
    ],
    softwareBrake: {
      heading: '反过来，软件不能因为第二幕三个字就买',
      notEqual: '现在 Salesforce 等软件股上涨确实很明显，但这并不证明：软件 = 第二幕 = 低估 = 可以买。',
      salesforceNote: '委员会转述：Salesforce 最近强劲上涨，背后有真实业绩和AI产品进展，而不是单纯的板块轮动。',
      sourceStatus: UNVERIFIED,
      mustAsk: [
        'AI产品ARR',
        '客户数量',
        '付费率',
        'ARPU',
        '续费',
        '毛利',
        'FCF',
      ],
      thatMeans: '这才叫：算力 → 软件 → 收入 → 利润。',
      priceLogic: '如果只是芯片涨多了、软件跌多了，所以软件轮动：那是价格逻辑。',
      forbidden: '价格不能迁生命线。所以这种东西不能成为鸿鹄的建仓理由。',
    },
    fifthLayer: {
      heading: '现在出现了一个更重要的第五层',
      rewrite: 'AI以后是不是会进入大脑？现在重新表达：AI产业链正在从卖算力转向卖智能。',
      chain: [
        '电力',
        '数据中心',
        'GPU / ASIC',
        '网络 / 存储',
        '模型',
        'Agent',
        '行业软件',
        '企业生产率',
        '真实利润',
      ],
      lastLayer: '最后这一层才是我们真正要找的东西。',
    },
    migrationHypothesis: {
      heading: '所以这次视频给鸿鹄带来的不是一个买卖信号',
      claim: 'AI主线没有被证伪，但资本回报最优环节可能正在从第一幕向第二、第三幕迁移。',
      status: 'OPEN',
      cannotProve: [
        '现在没有足够数据证明第一幕已经见顶。',
        '更不能证明第二幕已经成为新冠军。',
      ],
      nvidiaCounter: {
        heading: '而且最新英伟达财报其实给了我们一个反证',
        ifActOneEnded: '如果第一幕已经结束，那么英伟达最新财报不应该这么强。',
        fact: '委员会转述：约962亿美元收入，同比约+106%。',
        market: '委员会转述 Reuters：8月27日市场在财报和长期增长指引之后又重新大幅买入英伟达，股价当天上涨约6.8%，芯片板块同步走强。',
        sourceStatus: PUBLIC_NOT_YET_WIRED,
        reasonable: '所以现在最合理的结论不是硬件第一幕结束，而是：硬件仍然强，但市场开始要求第二幕证明。',
        not: '这两个结论差别巨大。',
      },
    },
    openHypotheses: [
      {
        id: 'H1',
        claim: 'AI算力第一幕仍然成立',
        status: 'OPEN',
        watch: ['GPU需求', '云厂CapEx', '数据中心建设', '光通信需求', '服务器需求', '电力需求'],
        sourceStatus: UNVERIFIED,
      },
      {
        id: 'H2',
        claim: '第二幕正在形成',
        status: 'OPEN',
        watch: ['AI软件收入', 'Agent付费', '企业AI渗透率', 'AI带来的ARPU提升', 'AI带来的企业利润改善'],
        sourceStatus: UNVERIFIED,
      },
      {
        id: 'H3',
        claim: '资本市场正在进行利润中心迁移',
        status: 'OPEN',
        watch: ['硬件利润增速', '软件 / 应用利润增速'],
        sourceStatus: UNVERIFIED,
      },
      {
        id: 'H4',
        claim: 'AI资本开支开始出现金融杠杆',
        status: 'OPEN',
        watch: ['CapEx', '债务', '算力租赁', '客户收入', 'FCF'],
        sourceStatus: UNVERIFIED,
      },
    ],
    hpcHypothesis: {
      id: 'H-PC',
      claim: 'AI主线没有被证伪，但资本回报最优环节可能正在从第一幕向第二、第三幕迁移',
      status: 'OPEN',
      place: '宏观 / 产业假设。不能进入 Action。不进证据链。不进看台必须处理。',
      cannotConclude: '不能得出硬件第一幕结束，也不能得出软件已经成为新冠军。',
      canConclude: '硬件仍然强，但市场开始要求第二幕证明。继续持有有证据支撑的第一幕冠军，同时开始寻找第二幕中已经进入财务报表的冠军。',
    },
    decisionNow: {
      heading: '所以现在的决策结论很明确',
      doNot: [
        '不要因为这条视频减仓中际旭创。',
        '不要因为软件反弹就立即去买软件。',
        '更不要因为第一幕到第二幕这个故事改变鸿鹄规则。',
      ],
      should: '继续持有有证据支撑的第一幕冠军，同时开始寻找第二幕中已经进入财务报表的冠军。',
      switchTo: '不是从硬件切到软件。而是从 AI 故事切换到 AI 经济产出。',
      nextPool: '谁已经把AI变成收入 → 利润 → 现金流，谁才真正有资格进入下一轮候选池。',
      contrast: [
        { name: '兆易创新', meaning: '基本面突然强化 + 回购强化 → 重新审查' },
        { name: '中际旭创', meaning: '主线盈利仍然强 → 继续验证' },
        { name: '软件', meaning: '板块上涨 → 没有资本迁移资格' },
      ],
      frozenState: '这才是鸿鹄冻结之后应该有的状态：不追逐叙事迁移，只等待证据迁移。',
    },
    forbiddenNow: [
      '不得写成软件股要涨了。',
      '不得写成英伟达基本面坏了。',
      '不得把融资平台写成客户没钱买芯片。',
      '不得写成第一幕已经结束。',
      '不得写成第二幕已经成为新冠军。',
      '不得因为软件上涨减仓中际。',
      '不得因为第二幕三个字买入软件。',
      '不得因为AI还很好就买所有AI硬件。',
      '不得把板块轮动写成 Capital Permission。',
      '不得把 STRETCHED 写成卖出。',
      '不得把浪潮、Salesforce 新增进 MAINLINES。',
      '不得把 H-PC 写进证据链。',
      '不得改 V4.x。不得加 V5。',
      '本层不发令。',
    ],
    nextWatch: [
      'GPU卖了多少，更要看GPU产生了多少真实收入和自由现金流。',
      'H1：第一幕是否仍成立。云厂CapEx、光通信、电力。',
      'H2：第二幕是否进入财报。ARR、付费、ARPU、续费、FCF。',
      'H3：硬件利润增速对软件 / 应用利润增速。',
      'H4：CapEx → 债务 → 算力租赁 → 客户收入 → FCF。对接 F-01。',
      '中际 / 新易盛：订单、出货、ASP、毛利、海外CapEx、FCF。强化则 Ownership 不变。',
      '如果有人写出「软件涨了所以卖中际」或「第二幕所以买软件」，系统必须拦住。对接 T-01。',
    ],
    flags: { ...FALSE },
  }
}

export function renderAiFourActs(): string {
  const v = buildAiFourActsView()
  const W = 122
  const L: string[] = ['', '═'.repeat(W), `${v.id}｜${v.title}`, '═'.repeat(W)]
  L.push('  本区不打分、不排序、不产生候选、不产生动作。证据等级恒为 OBSERVATION。')
  L.push('  不改 V4.x。不加 V5。不追逐叙事迁移，只等待证据迁移。')
  L.push(`  ${v.oneQuestion}`)
  L.push(`  ${v.keepHalf}`)
  L.push(`  ${v.correctHalf}`)
  L.push(`  ${v.hpcHypothesis.id}｜${v.hpcHypothesis.claim}　${v.hpcHypothesis.status}`)
  L.push(`  ${v.hpcHypothesis.place}`)
  L.push('')
  L.push(`  ── ${v.facts.heading} ──`)
  L.push(`  ${v.facts.nvidiaEarnings.claim}　${v.facts.nvidiaEarnings.verdict}`)
  for (const n of v.facts.nvidiaEarnings.committeeNotes) L.push(`      ${n}`)
  L.push(`      来源状态：${v.facts.nvidiaEarnings.sourceStatus}`)
  L.push(`  ${v.facts.financingPlatform.claim}　${v.facts.financingPlatform.verdict}`)
  for (const n of v.facts.financingPlatform.committeeNotes) L.push(`      ${n}`)
  L.push(`      ${v.facts.financingPlatform.meaning}`)
  L.push(`      来源状态：${v.facts.financingPlatform.sourceStatus}`)
  L.push('')
  L.push(`  ── ${v.fourActs.heading} ──`)
  L.push(`  ${v.fourActs.directionRight}`)
  for (const a of v.fourActs.acts) L.push(`  ${a.id}　${a.name}　${a.asks}　谁赚钱：${a.whoEarns}`)
  L.push(`  ${v.fourActs.oldTrade}`)
  L.push(`  ${v.fourActs.newTrade}`)
  L.push('')
  L.push(`  ── ${v.financingIsNotPoverty.heading} ──`)
  L.push(`  ${v.financingIsNotPoverty.wrongRead}`)
  L.push(`  ${v.financingIsNotPoverty.official}`)
  L.push(`  ${v.financingIsNotPoverty.accurate}`)
  L.push(`  ${v.financingIsNotPoverty.highway}`)
  L.push(`  ${v.financingIsNotPoverty.newRisk}`)
  L.push(`  ${v.financingIsNotPoverty.mustWatch}`)
  L.push(`  ${v.financingIsNotPoverty.connectsTo}`)
  L.push('')
  L.push(`  ── ${v.profitCenter.heading} ──`)
  L.push(`  ${v.profitCenter.notAsk}`)
  L.push(`  ${v.profitCenter.realAsk}`)
  for (const e of v.profitCenter.earlyEvidence) L.push(`  ${e}`)
  L.push(`  ${v.profitCenter.dangerousThought}`)
  L.push(`  ${v.profitCenter.whyWrong}`)
  L.push('')
  L.push('  ── 对现有持仓重新分层。软件涨不是卖中际 ──')
  for (const h of v.holdingRechecks) {
    L.push(`  ${h.name}　${h.band}${h.inMainlines ? '' : '　不进 MAINLINES'}`)
    for (const q of h.shouldAsk) L.push(`      问：${q}`)
    L.push(`      ${h.ifStrengthens}`)
    L.push(`      ${h.ifStretched}`)
    L.push(`      ${h.r4Note}`)
  }
  L.push('')
  L.push(`  ── ${v.softwareBrake.heading} ──`)
  L.push(`  ${v.softwareBrake.notEqual}`)
  L.push(`  ${v.softwareBrake.salesforceNote}`)
  L.push(`  必须问：${v.softwareBrake.mustAsk.join(' → ')}`)
  L.push(`  ${v.softwareBrake.thatMeans}`)
  L.push(`  ${v.softwareBrake.priceLogic}`)
  L.push(`  ${v.softwareBrake.forbidden}`)
  L.push('')
  L.push(`  ── ${v.fifthLayer.heading} ──`)
  L.push(`  ${v.fifthLayer.rewrite}`)
  L.push(`  ${v.fifthLayer.chain.join(' → ')}`)
  L.push(`  ${v.fifthLayer.lastLayer}`)
  L.push('')
  L.push(`  ── ${v.migrationHypothesis.heading} ──`)
  L.push(`  ${v.migrationHypothesis.claim}　${v.migrationHypothesis.status}`)
  for (const x of v.migrationHypothesis.cannotProve) L.push(`  ${x}`)
  L.push(`  ${v.migrationHypothesis.nvidiaCounter.heading}`)
  L.push(`  ${v.migrationHypothesis.nvidiaCounter.ifActOneEnded}`)
  L.push(`  ${v.migrationHypothesis.nvidiaCounter.fact}`)
  L.push(`  ${v.migrationHypothesis.nvidiaCounter.market}`)
  L.push(`  ${v.migrationHypothesis.nvidiaCounter.reasonable}`)
  L.push(`  ${v.migrationHypothesis.nvidiaCounter.not}`)
  L.push('')
  L.push('  ── 四个待验证假设。没有一个自动买卖 ──')
  for (const h of v.openHypotheses) {
    L.push(`  ${h.id}　${h.claim}　${h.status}　${h.sourceStatus}`)
    L.push(`      观察：${h.watch.join('；')}`)
  }
  L.push('')
  L.push(`  ── ${v.decisionNow.heading} ──`)
  for (const x of v.decisionNow.doNot) L.push(`  · ${x}`)
  L.push(`  ${v.decisionNow.should}`)
  L.push(`  ${v.decisionNow.switchTo}`)
  L.push(`  ${v.decisionNow.nextPool}`)
  for (const c of v.decisionNow.contrast) L.push(`  ${c.name}　${c.meaning}`)
  L.push(`  ${v.decisionNow.frozenState}`)
  L.push('')
  L.push(`  ${v.hpcHypothesis.cannotConclude}`)
  L.push(`  ${v.hpcHypothesis.canConclude}`)
  L.push('')
  L.push('  ── 现在禁止写成 ──')
  for (const x of v.forbiddenNow) L.push(`  · ${x}`)
  L.push('')
  L.push('  ── 下一步只观察 ──')
  for (const x of v.nextWatch) L.push(`  · ${x}`)
  L.push('')
  return L.join('\n')
}
