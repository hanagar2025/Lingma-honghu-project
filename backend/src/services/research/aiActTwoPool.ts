/**
 * 研究层 · S-01 鸿鹄·AI第二幕候选池
 *
 * 这一层不生产动作。
 * 这一层不改规则。
 * 这一层不增加指标。
 * 这一层不进入证据链。
 *
 * 现在就应该提前建候选池，但不能提前把候选池变成持仓。
 *
 * 我们不是预测软件要涨，而是在提前寻找：
 * 如果资本真的从 AI 硬件向 AI 软件迁移，谁最有资格承接这笔资本。
 *
 * 候选池不是买入池。
 * 是证据观察池。
 *
 * 层级不是买入评分。
 * 而是：如果 AI 资本迁移被确认，我愿意优先研究谁。
 *
 * Ownership 候选不等于 Capital Permission 成立。
 */

const TIER = 'OBSERVATION' as const
const PUBLIC_NOT_YET_WIRED = 'PUBLIC_NOT_YET_WIRED'
const UNVERIFIED = 'UNVERIFIED'

export type ActTwoPoolView = {
  id: 'S-01'
  title: '鸿鹄·AI第二幕候选池'
  tier: typeof TIER
  phase: 'V4.x Decision Validation Phase'
  frozen: true
  v5Undefined: true
  oneQuestion: string
  whatThisIs: readonly string[]
  whatThisIsNot: readonly string[]
  conclusion: string
  notSoftwareSector: {
    heading: string
    firstFilter: string
    types: readonly { kind: string; names: string; watch: string }[]
    noMeaning: string
    realMeaning: string
  }
  lines: readonly {
    id: string
    name: string
    why: string
    names: readonly string[]
  }[]
  kingdee: {
    heading: string
    notABuy: string
    ifMigration: string
    layers: readonly { id: string; title: string; note: string }[]
    committeeNotes: readonly string[]
    sourceStatus: typeof PUBLIC_NOT_YET_WIRED
    chainStarted: string
    gap: string
    verdict: string
  }
  kingsoft: {
    heading: string
    why: string
    committeeNotes: readonly string[]
    sourceStatus: typeof PUBLIC_NOT_YET_WIRED
    mustDeduct: string
    mustTrack: readonly string[]
    ifClears: string
    now: string
  }
  pool: readonly {
    name: string
    market: 'A' | 'H'
    line: string
    priority: '优先深挖' | '高优先验证' | '重点跟踪' | '对照观察'
    why: string
    inMainlines: false
  }[]
  reverseList: {
    heading: string
    why: string
    items: readonly string[]
    danger: string
  }
  confirmSignals: {
    heading: string
    notARule: true
    allNeeded: string
    signals: readonly { id: string; name: string; is: string; isNot: string }[]
    whenConfirmed: string
  }
  todayTape: {
    heading: string
    committeeNotes: readonly string[]
    sourceStatus: typeof UNVERIFIED
    labels: readonly { tag: string; state: string }[]
    oneDay: string
  }
  dailyAsks: readonly { name: string; asks: string }[]
  evidenceMatrix: {
    heading: string
    notAScore: true
    layers: readonly { id: string; name: string }[]
    names: readonly string[]
    cells: readonly {
      name: string
      layer: string
      state: '初步证据' | '缺口' | '尚未可测' | '未验证' | '战略层未裁定'
      note: string
    }[]
  }
  hs2Hypothesis: {
    id: 'H-S2'
    claim: string
    status: 'OPEN'
    place: string
    cannotConclude: string
    canConclude: string
    topThree: readonly string[]
    fourth: string
  }
  forbiddenNow: readonly string[]
  nextWatch: readonly string[]
  flags: {
    poolIsBuyList: false
    starsAreBuyScore: false
    softwareSectorIsOneIndustry: false
    softwareWillRise: false
    kingdeeMayBuyNow: false
    kingsoftIsConfirmedChampion: false
    oneDayTapeConfirmsMigration: false
    actTwoIsNewMainline: false
    thisChangesV4x: false
    thisAddsV5: false
    thisLayerIssuesOrders: false
    hypothesisEntersEvidence: false
    candidateEqualsPermission: false
    addPoolToMainlines: false
    priceMigratesLifeline: false
  }
}

const FALSE = {
  poolIsBuyList: false,
  starsAreBuyScore: false,
  softwareSectorIsOneIndustry: false,
  softwareWillRise: false,
  kingdeeMayBuyNow: false,
  kingsoftIsConfirmedChampion: false,
  oneDayTapeConfirmsMigration: false,
  actTwoIsNewMainline: false,
  thisChangesV4x: false,
  thisAddsV5: false,
  thisLayerIssuesOrders: false,
  hypothesisEntersEvidence: false,
  candidateEqualsPermission: false,
  addPoolToMainlines: false,
  priceMigratesLifeline: false,
} as const

export function buildAiActTwoPoolView(): ActTwoPoolView {
  return {
    id: 'S-01',
    title: '鸿鹄·AI第二幕候选池',
    tier: TIER,
    phase: 'V4.x Decision Validation Phase',
    frozen: true,
    v5Undefined: true,
    oneQuestion: '如果资本真的从AI硬件向AI软件迁移，谁最有资格承接这笔资本？',
    whatThisIs: [
      '证据观察池。现在就建，但不能变成持仓。',
      '提前寻找承接资格，不是预测软件要涨。',
      '层级是研究优先顺序，不是买入评分。',
    ],
    whatThisIsNot: [
      '不是买入池。',
      '不是新主线。',
      '不是 Capital Permission。',
      '不改 V4.x。不加 V5。',
      '不进看台必须处理。',
      '不新增任何标的进 MAINLINES。',
    ],
    conclusion:
      '不要提前押软件一定是下一条主线。应该押一个更严谨的假设：如果AI从算力建设周期进入经济产出验证周期，那么企业软件、办公AI、金融IT、工业软件将成为最重要的利润承接方向之一。然后让数据决定谁成为冠军。',
    notSoftwareSector: {
      heading: '先不要把软件板块当成一个行业',
      firstFilter: '这是第一道筛选。所谓软件，里面其实有完全不同的商业模式。',
      types: [
        { kind: 'AI办公', names: '金山办公', watch: 'AI付费、用户转化、订阅' },
        { kind: '企业ERP / SaaS', names: '金蝶、用友', watch: 'ARR、订阅、AI增购' },
        { kind: '金融IT', names: '同花顺、恒生', watch: 'AI增值收入、客户付费' },
        { kind: '工业软件', names: '宝信、中控、鼎捷', watch: 'AI进入生产环节' },
        { kind: '安全软件', names: '深信服、启明星辰', watch: 'AI安全需求' },
        { kind: 'AI工具', names: '合合、福昕', watch: '用户到付费' },
        { kind: 'AI营销', names: '蓝色光标、易点天下', watch: 'AI提高广告效率' },
        { kind: 'Agent / 平台', names: '润和等', watch: '订单、客户、商业化' },
        { kind: '大模型', names: '科大讯飞等', watch: '模型收入及应用兑现' },
      ],
      noMeaning: '软件板块上涨没有投资意义。',
      realMeaning: '真正有意义的是：哪一个软件子行业开始出现持续的盈利兑现？',
    },
    lines: [
      {
        id: 'L1',
        name: '企业AI / ERP / Agent',
        why: '企业软件天然拥有企业数据、工作流、权限体系和业务规则。这恰恰是Agent真正进入企业生产流程所需要的。金蝶国际优先于用友网络，再用中国软件国际作落地对照。',
        names: ['金蝶国际', '用友网络', '中国软件国际'],
      },
      {
        id: 'L2',
        name: 'AI办公',
        why: '用户多、使用频率高、产品成熟、付费路径清晰。金山办公是A股软件里面非常重要的第一候选。',
        names: ['金山办公'],
      },
      {
        id: 'L3',
        name: 'AI金融IT',
        why: '同花顺偏C端金融信息入口，商业闭环干净，是高商业兑现候选。恒生电子是金融机构AI基础软件候选。不能仅凭AI升级四个字给资本迁移资格。',
        names: ['同花顺', '恒生电子'],
      },
      {
        id: 'L4',
        name: '工业软件',
        why: '如果AI真正进入实体经济，最有价值的地方可能不是写一篇文章，而是生产计划、排产、质检、设备维护、能耗、供应链、工艺优化。重点盯，但不要急着买。',
        names: ['宝信软件', '中控技术', '鼎捷数智', '赛意信息'],
      },
    ],
    kingdee: {
      heading: '金蝶是目前最值得提前盯的一只',
      notABuy: '不是现在告诉你买金蝶。',
      ifMigration: '如果未来真的发生AI硬件到AI应用的资本迁移，金蝶是会优先验证的核心候选。',
      layers: [
        { id: '1', title: '战略', note: '企业数字化 → AI原生ERP → Agent。' },
        { id: '2', title: '客户', note: '大型企业、制造业、半导体、新能源等。' },
        { id: '3', title: '产品', note: '灵基、AI Suite。灵基已进入财务、供应链、采购、制造等实际流程。' },
        { id: '4', title: '收入', note: 'AI原生产品收入同比约+189%。' },
        { id: '5', title: '合同', note: '新签合同金额同比约+159.2%。' },
        { id: '6', title: '订阅', note: 'AI原生产品订阅收入同比约+282.9%。' },
        { id: '7', title: '整体ARR', note: '约+18.3%。' },
      ],
      committeeNotes: [
        '委员会转述：金蝶2026年上半年收入约36.25亿元，同比增长约13.6%。',
        '委员会转述：云服务收入约+16.6%，订阅收入约+20.4%，ARR约+18.3%。',
        '委员会转述：AI原生产品收入同比约+189%至约2.96亿元，新签合同金额同比约+159.2%，订阅收入同比约+282.9%。',
      ],
      sourceStatus: PUBLIC_NOT_YET_WIRED,
      chainStarted: '这已经不是AI概念。至少开始出现：AI产品 → 新签 → 订阅 → ARR。AI产品不是功能，而是正在形成新的收入层。',
      gap: '关键缺口：AI收入现在仍然太小。约2.96亿元相对于约36.25亿元总收入，仍然不是决定公司整体盈利的量级。',
      verdict: '所以它现在是：Ownership候选，不等于 Capital Permission 成立。这恰好符合鸿鹄。',
    },
    kingsoft: {
      heading: '金山办公：A股AI应用核心候选，还不是确认的新主线冠军',
      why: '优势非常简单：用户多、使用频率高、产品成熟、付费路径清晰。',
      committeeNotes: [
        '委员会转述：2026年上半年业绩预告，营收预计约32.14–34.13亿元，同比增长约21%–28%；归母净利润预计增长约210%–264%。',
        '委员会转述：其中投资收益对净利润贡献明显，调整后归母净利润增幅明显低于表面数字。',
      ],
      sourceStatus: PUBLIC_NOT_YET_WIRED,
      mustDeduct: '不能看到净利润暴增就说AI商业化成功。必须严格扣掉投资收益。',
      mustTrack: [
        'WPS AI付费用户',
        'AI ARPU',
        'AI订阅收入',
        '企业AI收入',
        'AI收入占比',
        'AI带来的增量利润',
      ],
      ifClears: '如果未来几个季度这条链越来越清楚：金山办公就可能成为A股AI应用第一中军。',
      now: '但现在仍然是高质量候选，而不是已经确认的新主线冠军。',
    },
    pool: [
      { name: '金山办公', market: 'A', line: 'AI办公', priority: '优先深挖', why: 'A股AI应用中军候选。付费路径清晰。', inMainlines: false },
      { name: '金蝶国际', market: 'H', line: '企业AI / ERP', priority: '优先深挖', why: '企业AI / Agent最值得验证。已出现收入层，但量级仍小。', inMainlines: false },
      { name: '同花顺', market: 'A', line: 'AI金融IT', priority: '高优先验证', why: 'AI商业化现金流验证最直接。', inMainlines: false },
      { name: '恒生电子', market: 'A', line: 'AI金融IT', priority: '高优先验证', why: '金融机构AI基础软件候选。增量收入仍要拆开。', inMainlines: false },
      { name: '宝信软件', market: 'A', line: '工业软件', priority: '重点跟踪', why: '不是简单的软件股，而是AI乘工业生产率交叉点。', inMainlines: false },
      { name: '中控技术', market: 'A', line: '工业软件', priority: '重点跟踪', why: '工业AI加自动化。重点盯，不要急着买。', inMainlines: false },
      { name: '中国软件国际', market: 'H', line: '企业IT服务', priority: '重点跟踪', why: '企业IT服务 / AI落地对照。', inMainlines: false },
      { name: '鼎捷数智', market: 'A', line: '工业软件', priority: '对照观察', why: '制造业AI Agent对照。', inMainlines: false },
      { name: '合合信息', market: 'A', line: 'AI工具', priority: '对照观察', why: 'AI工具 / 文档 / OCR对照。', inMainlines: false },
      { name: '科大讯飞', market: 'A', line: '大模型', priority: '对照观察', why: '大模型加应用，验证难度更高。', inMainlines: false },
      { name: '用友网络', market: 'A', line: '企业ERP', priority: '对照观察', why: '战略方向对，商业兑现仍需观察。', inMainlines: false },
      { name: '深信服', market: 'A', line: '安全软件', priority: '对照观察', why: 'AI安全长期价值，但暂非最纯主线。', inMainlines: false },
    ],
    reverseList: {
      heading: '反向名单：如果软件真的成为下一条主线，也不会因为涨得最猛就买',
      why: '这类股票非常容易出现：第二幕的故事，第一幕的估值。这是最危险的组合。',
      items: [
        '纯概念大模型',
        '只有AI订单新闻、没有收入',
        'AI收入无法拆分',
        '净利润增长来自投资收益',
        '大量政府项目但现金流差',
        '客户集中度过高',
        'AI产品免费使用、无法证明付费',
        '靠并购制造增长',
        '估值已经提前反映多年增长',
      ],
      danger: '第二幕的故事，第一幕的估值。',
    },
    confirmSignals: {
      heading: '真正要确认资金迁移，需要四个信号同时出现',
      notARule: true,
      allNeeded: '这一步成为观察协议，但不是修改鸿鹄规则。一天不能证明趋势。',
      signals: [
        {
          id: 'S1',
          name: '板块资金',
          is: '软件成交额占比持续提升，并且相对AI硬件资金出现持续迁移。',
          isNot: '不是一天软件涨5%。',
        },
        {
          id: 'S2',
          name: '龙头中军',
          is: '金山办公 / 金蝶 / 同花顺 / 恒生 / 宝信，至少出现2到3个中军同步强化。',
          isNot: '不是小票集体涨。',
        },
        {
          id: 'S3',
          name: '盈利兑现',
          is: 'AI收入增长、ARR增长、新签合同增长、毛利率改善、FCF改善开始同时出现。',
          isNot: '这是最重要的一条。',
        },
        {
          id: 'S4',
          name: '相对盈利预期改善',
          is: '软件公司的盈利预期上调速度，大于AI硬件公司的盈利预期上调速度。',
          isNot: '最后才是这一条。出现这一条，才可以说利润中心迁移得到初步确认。',
        },
      ],
      whenConfirmed: '如果四条同时出现，我才会说：AI产业利润中心迁移得到初步确认。现在一条都还不能当成已经成立。',
    },
    todayTape: {
      heading: '今天这个市场动作非常值得记录',
      committeeNotes: [
        '委员会转述：2026-08-28 港股云计算 / 软件方向出现明显上涨，金蝶一度涨超11%，迈富时、金山云、明源云等同步上涨。',
        '委员会转述：触发因素之一是国家知识产权局、国家数据局发布数据资源开发利用相关意见，提到推进AI、大数据、云计算以及行业大模型开发、训练和落地。',
      ],
      sourceStatus: UNVERIFIED,
      labels: [
        { tag: '资金行为', state: '已出现' },
        { tag: '产业趋势', state: '值得验证' },
        { tag: '资本迁移', state: '尚未确认' },
      ],
      oneDay: '因为一天不能证明趋势。这个可以作为资金行为观察，但不能当作资本迁移已经成立的证据。',
    },
    dailyAsks: [
      { name: '金山办公', asks: 'AI收入有没有继续强化？' },
      { name: '金蝶国际', asks: 'AI ARR / 新签 / 订阅是否继续强化？' },
      { name: '同花顺', asks: 'AI是否带来增量用户和收入？' },
      { name: '恒生电子', asks: '金融机构AI订单是否转收入？' },
      { name: '宝信 / 中控', asks: '工业AI是否进入利润表？' },
      { name: '软件板块', asks: '中军是否开始跑赢AI硬件？' },
    ],
    evidenceMatrix: {
      heading: '前四个按鸿鹄九层证据链做成观察矩阵',
      notAScore: true,
      layers: [
        { id: 'M1', name: '战略资格' },
        { id: 'M2', name: '主线归因' },
        { id: 'M3', name: '当前利润' },
        { id: 'M4', name: 'AI收入' },
        { id: 'M5', name: '新独立证据族' },
        { id: 'M6', name: '未来盈利' },
        { id: 'M7', name: 'R4' },
        { id: 'M8', name: '现金流' },
        { id: 'M9', name: '资本迁移资格' },
      ],
      names: ['金山办公', '金蝶国际', '同花顺', '宝信软件'],
      cells: [
        { name: '金山办公', layer: '战略资格', state: '战略层未裁定', note: '候选，不是已确认新主线。' },
        { name: '金山办公', layer: '主线归因', state: '未验证', note: '办公AI付费是否就是利润来源，还要拆。' },
        { name: '金山办公', layer: '当前利润', state: '缺口', note: '表面净利润暴增，必须扣掉投资收益。' },
        { name: '金山办公', layer: 'AI收入', state: '缺口', note: '要看WPS AI付费、ARPU、订阅、企业AI收入占比。' },
        { name: '金山办公', layer: '新独立证据族', state: '未验证', note: '还没有新的独立证据族进入决策层。' },
        { name: '金山办公', layer: '未来盈利', state: '未验证', note: 'AI增量利润链尚未走完。' },
        { name: '金山办公', layer: 'R4', state: '尚未可测', note: 'R4 不能用PE填。STRETCHED 不能卖。' },
        { name: '金山办公', layer: '现金流', state: '未验证', note: '要看AI订阅是否变成现金。' },
        { name: '金山办公', layer: '资本迁移资格', state: '缺口', note: '高质量候选，不是 Capital Permission。' },

        { name: '金蝶国际', layer: '战略资格', state: '战略层未裁定', note: 'Ownership候选，港股，不进 MAINLINES。' },
        { name: '金蝶国际', layer: '主线归因', state: '初步证据', note: 'AI原生产品开始形成新的收入层，但仍要证明它驱动公司变化。' },
        { name: '金蝶国际', layer: '当前利润', state: '未验证', note: '上半年收入约+13.6%，整体盈利是否被AI改写，还不知道。' },
        { name: '金蝶国际', layer: 'AI收入', state: '初步证据', note: 'AI原生产品收入约+189%至约2.96亿，但相对约36.25亿仍然太小。' },
        { name: '金蝶国际', layer: '新独立证据族', state: '未验证', note: '新签、订阅、ARR开始同步，是否构成新的独立族，还要审。' },
        { name: '金蝶国际', layer: '未来盈利', state: '未验证', note: '灵基进入实际流程，不等于未来利润已经可测。' },
        { name: '金蝶国际', layer: 'R4', state: '尚未可测', note: '一天涨超11%不能填 R4。' },
        { name: '金蝶国际', layer: '现金流', state: '未验证', note: '订阅和ARR要落到现金。' },
        { name: '金蝶国际', layer: '资本迁移资格', state: '缺口', note: 'Ownership候选不等于 Capital Permission 成立。' },

        { name: '同花顺', layer: '战略资格', state: '战略层未裁定', note: '高商业兑现候选，不是持仓。' },
        { name: '同花顺', layer: '主线归因', state: '未验证', note: '用户到数据到AI工具到付费，这条链要证明增量来自AI。' },
        { name: '同花顺', layer: '当前利润', state: '初步证据', note: '委员会转述2026Q1营收约+40.8%，归母净利润约+112.6%。' },
        { name: '同花顺', layer: 'AI收入', state: '缺口', note: 'AI增值收入还要拆开。' },
        { name: '同花顺', layer: '新独立证据族', state: '未验证', note: '还没有进入决策层的新独立族。' },
        { name: '同花顺', layer: '未来盈利', state: '未验证', note: 'C端付费能否持续，仍要看。' },
        { name: '同花顺', layer: 'R4', state: '尚未可测', note: 'R4 不能用涨幅填。' },
        { name: '同花顺', layer: '现金流', state: '初步证据', note: '委员会转述经营现金流净额约8.39亿元。仍要核是否来自AI。' },
        { name: '同花顺', layer: '资本迁移资格', state: '缺口', note: '闭环干净，不等于现在可以给资本。' },

        { name: '宝信软件', layer: '战略资格', state: '战略层未裁定', note: '工业生产率交叉点，不是互联网软件。' },
        { name: '宝信软件', layer: '主线归因', state: '未验证', note: '工业AI是否进入生产环节，还要看收入拆分。' },
        { name: '宝信软件', layer: '当前利润', state: '未验证', note: '先不要把工业软件当成已经拐点。' },
        { name: '宝信软件', layer: 'AI收入', state: '缺口', note: '工业AI收入尚未拆到可核验。' },
        { name: '宝信软件', layer: '新独立证据族', state: '未验证', note: '没有新的独立证据族。' },
        { name: '宝信软件', layer: '未来盈利', state: '未验证', note: '排产、质检、能耗、供应链若进入利润表，才算拐点。' },
        { name: '宝信软件', layer: 'R4', state: '尚未可测', note: 'R4 尚未可测。' },
        { name: '宝信软件', layer: '现金流', state: '未验证', note: '工业项目现金流要单独核。' },
        { name: '宝信软件', layer: '资本迁移资格', state: '缺口', note: '重点盯，不要急着买。' },
      ],
    },
    hs2Hypothesis: {
      id: 'H-S2',
      claim: '如果AI从算力建设周期进入经济产出验证周期，企业软件、办公AI、金融IT、工业软件将成为最重要的利润承接方向之一',
      status: 'OPEN',
      place: '证据观察池。不是买入池。不进证据链。不进看台必须处理。不新增进 MAINLINES。',
      cannotConclude: '不能提前押软件一定是下一条主线。不能把候选池写成持仓。不能把一天软件上涨写成资本迁移。',
      canConclude: '现在就应该提前建候选池，并按九层证据链逐项检查。然后让数据决定谁成为冠军。',
      topThree: ['金山办公', '金蝶国际', '同花顺'],
      fourth: '宝信软件',
    },
    forbiddenNow: [
      '不得把候选池写成买入池。',
      '不得把层级写成买入评分。',
      '不得把软件板块当成一个行业来买。',
      '不得现在买金蝶。',
      '不得把金山办公写成已确认的新主线冠军。',
      '不得把一天涨超11%写成资本迁移成立。',
      '不得把净利润暴增写成AI商业化成功。',
      '不得把第二幕故事配上第一幕估值。',
      '不得把浪潮式硬件逻辑套到软件上。',
      '不得把池内任何公司新增进 MAINLINES。',
      '不得把 H-S2 写进证据链。',
      '不得改 V4.x。不得加 V5。',
      '本层不发令。',
    ],
    nextWatch: [
      '每天只问六句：金山AI收入、金蝶ARR/新签/订阅、同花顺增量、恒生订单转收入、工业AI进利润表、中军是否跑赢硬件。',
      '四个确认信号必须同时出现，才谈利润中心迁移初步确认。',
      '九层矩阵先盯缺口：金山扣投资收益、金蝶AI收入量级、同花顺AI拆分、宝信工业AI进表。',
      '反向名单继续挡：免费、无法拆分、投资收益、并购增长、估值透支。',
      '对接 A-01：这是第二幕候选，不是第一幕结束。',
      '对接 T-01：这个观察池不能直接指挥资本。',
    ],
    flags: { ...FALSE },
  }
}

export function renderAiActTwoPool(): string {
  const v = buildAiActTwoPoolView()
  const W = 122
  const L: string[] = ['', '═'.repeat(W), `${v.id}｜${v.title}`, '═'.repeat(W)]
  L.push('  本区不打分、不排序、不产生候选动作、不产生买卖。证据等级恒为 OBSERVATION。')
  L.push('  候选池不是买入池。层级不是买入评分。不改 V4.x。不加 V5。')
  L.push(`  ${v.oneQuestion}`)
  L.push(`  ${v.conclusion}`)
  L.push(`  ${v.hs2Hypothesis.id}｜${v.hs2Hypothesis.claim}　${v.hs2Hypothesis.status}`)
  L.push(`  ${v.hs2Hypothesis.place}`)
  L.push('')
  L.push(`  ── ${v.notSoftwareSector.heading} ──`)
  L.push(`  ${v.notSoftwareSector.firstFilter}`)
  for (const t of v.notSoftwareSector.types) L.push(`  ${t.kind}　${t.names}　看：${t.watch}`)
  L.push(`  ${v.notSoftwareSector.noMeaning}`)
  L.push(`  ${v.notSoftwareSector.realMeaning}`)
  L.push('')
  L.push('  ── 四条研究主线 ──')
  for (const line of v.lines) {
    L.push(`  ${line.id}　${line.name}　${line.names.join(' / ')}`)
    L.push(`      ${line.why}`)
  }
  L.push('')
  L.push(`  ── ${v.kingdee.heading} ──`)
  L.push(`  ${v.kingdee.notABuy}`)
  L.push(`  ${v.kingdee.ifMigration}`)
  for (const n of v.kingdee.committeeNotes) L.push(`      ${n}`)
  L.push(`      来源状态：${v.kingdee.sourceStatus}`)
  for (const layer of v.kingdee.layers) L.push(`  ${layer.id}. ${layer.title}　${layer.note}`)
  L.push(`  ${v.kingdee.chainStarted}`)
  L.push(`  ${v.kingdee.gap}`)
  L.push(`  ${v.kingdee.verdict}`)
  L.push('')
  L.push(`  ── ${v.kingsoft.heading} ──`)
  L.push(`  ${v.kingsoft.why}`)
  for (const n of v.kingsoft.committeeNotes) L.push(`      ${n}`)
  L.push(`      来源状态：${v.kingsoft.sourceStatus}`)
  L.push(`  ${v.kingsoft.mustDeduct}`)
  L.push(`  必须追踪：${v.kingsoft.mustTrack.join(' → ')}`)
  L.push(`  ${v.kingsoft.ifClears}`)
  L.push(`  ${v.kingsoft.now}`)
  L.push('')
  L.push('  ── 观察池。不是买入池。全部不进 MAINLINES ──')
  for (const p of v.pool) {
    L.push(`  ${p.priority}　${p.name}　${p.market}　${p.line}`)
    L.push(`      ${p.why}`)
  }
  L.push('')
  L.push(`  ── ${v.reverseList.heading} ──`)
  for (const x of v.reverseList.items) L.push(`  · ${x}`)
  L.push(`  ${v.reverseList.danger}`)
  L.push('')
  L.push(`  ── ${v.confirmSignals.heading} ──`)
  L.push(`  ${v.confirmSignals.allNeeded}`)
  for (const s of v.confirmSignals.signals) {
    L.push(`  ${s.id}　${s.name}　${s.isNot}`)
    L.push(`      ${s.is}`)
  }
  L.push(`  ${v.confirmSignals.whenConfirmed}`)
  L.push('')
  L.push(`  ── ${v.todayTape.heading} ──`)
  for (const n of v.todayTape.committeeNotes) L.push(`      ${n}`)
  L.push(`      来源状态：${v.todayTape.sourceStatus}`)
  L.push(`  ${v.todayTape.labels.map(x => `${x.tag}：${x.state}`).join('　')}`)
  L.push(`  ${v.todayTape.oneDay}`)
  L.push('')
  L.push('  ── 每天只问 ──')
  for (const q of v.dailyAsks) L.push(`  ${q.name}　${q.asks}`)
  L.push('')
  L.push(`  ── ${v.evidenceMatrix.heading} ──`)
  L.push('  不是评分。逐项检查：战略资格 → 主线归因 → 当前利润 → AI收入 → 新独立证据族 → 未来盈利 → R4 → 现金流 → 资本迁移资格。')
  L.push(`  ${v.evidenceMatrix.layers.map(x => x.name).join(' → ')}`)
  for (const name of v.evidenceMatrix.names) {
    L.push(`  ${name}`)
    for (const c of v.evidenceMatrix.cells.filter(x => x.name === name)) {
      L.push(`      ${c.layer}　${c.state}　${c.note}`)
    }
  }
  L.push('')
  L.push(`  最想深挖：${v.hs2Hypothesis.topThree.join('、')}。第四个：${v.hs2Hypothesis.fourth}。`)
  L.push(`  ${v.hs2Hypothesis.cannotConclude}`)
  L.push(`  ${v.hs2Hypothesis.canConclude}`)
  L.push('')
  L.push('  ── 现在禁止写成 ──')
  for (const x of v.forbiddenNow) L.push(`  · ${x}`)
  L.push('')
  L.push('  ── 下一步只观察 ──')
  for (const x of v.nextWatch) L.push(`  · ${x}`)
  L.push('')
  return L.join('\n')
}
