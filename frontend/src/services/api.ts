/// <reference types="vite/client" />
import axios, { AxiosInstance, AxiosResponse } from 'axios'
import { isEncryptedSnapshot, type EncryptedSnapshot } from './decrypt'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000/api'

class APIClient {
  private client: AxiosInstance

  constructor() {
    this.client = axios.create({
      baseURL: API_BASE_URL,
      timeout: 60000,
      headers: {
        'Content-Type': 'application/json',
      },
    })

    this.client.interceptors.request.use(
      (config) => {
        const token = localStorage.getItem('token')
        if (token) {
          config.headers.Authorization = `Bearer ${token}`
        }
        return config
      },
      (error) => Promise.reject(error)
    )

    this.client.interceptors.response.use(
      (response) => response,
      (error) => {
        if (error.response?.status === 401) {
          localStorage.removeItem('token')
          window.location.href = '/login'
        }
        return Promise.reject(error)
      }
    )
  }

  // 统一提取data字段：{ success: true, data: {...} } → data
  private extractData<T>(responseData: any): T {
    if (responseData && typeof responseData === 'object' && 'success' in responseData && 'data' in responseData) {
      return responseData.data
    }
    return responseData
  }

  async get<T>(url: string, params?: any): Promise<T> {
    const response: AxiosResponse<T> = await this.client.get(url, { params })
    return this.extractData<T>(response.data)
  }

  async post<T>(url: string, data?: any): Promise<T> {
    const response: AxiosResponse<T> = await this.client.post(url, data)
    return this.extractData<T>(response.data)
  }

  async put<T>(url: string, data?: any): Promise<T> {
    const response: AxiosResponse<T> = await this.client.put(url, data)
    return this.extractData<T>(response.data)
  }

  async delete<T>(url: string): Promise<T> {
    const response: AxiosResponse<T> = await this.client.delete(url)
    return this.extractData<T>(response.data)
  }
}

const apiClient = new APIClient()

// 认证
export const authAPI = {
  login: (credentials: { username: string; password: string }) =>
    apiClient.post<{ user: any; token: string }>('/auth/login', credentials),

  register: (userData: { username: string; password: string; email?: string }) =>
    apiClient.post<{ user: any; token: string }>('/auth/register', userData),

  getProfile: () => apiClient.get<any>('/auth/profile'),

  logout: () => apiClient.post('/auth/logout'),
}

// 持仓
export const portfolioAPI = {
  getPositions: () => apiClient.get<any>('/portfolio/positions'),

  addPosition: (positionData: any) => apiClient.post<any>('/portfolio/positions', positionData),

  updatePosition: (id: string, data: any) => apiClient.put<any>(`/portfolio/positions/${id}`, data),

  deletePosition: (id: string) => apiClient.delete(`/portfolio/positions/${id}`),

  getPortfolioSummary: () => apiClient.get<any>('/portfolio/summary'),
}

// 行情（腾讯免费源）
export const marketAPI = {
  getStockQuotes: (stockCodes: string[]) =>
    apiClient.post<any[]>('/market/quotes', { codes: stockCodes }),

  searchStockByName: (name: string) =>
    apiClient.get<any[]>('/market/search', { name }),

  getBars: (code: string, limit = 120) =>
    apiClient.get<any[]>(`/market/bars/${code}`, { limit }),
}

// TIOS 规则引擎（大脑）
export const tiosAPI = {
  // 一键运行闭环：同步K线 → 生成盘前四问 → 入库
  run: (skipSync = false) => apiClient.post<any>('/tios/run', { skipSync }),

  getLatestReport: () => apiClient.get<any>('/tios/report/latest'),

  getReportHistory: (limit = 30) => apiClient.get<any[]>('/tios/reports', { limit }),

  getRuleCards: () => apiClient.get<any[]>('/tios/rule-cards'),

  updateRuleCard: (code: string, data: any) => apiClient.put(`/tios/rule-cards/${code}`, data),

  getAccount: () => apiClient.get<any>('/tios/account'),

  updateAccount: (data: { cash?: number; peakAssets?: number; householdAnnualExpense?: number }) =>
    apiClient.put('/tios/account', data),

  getExecutions: () => apiClient.get<any[]>('/tios/executions'),

  /** executedAt 可回填历史执行时间（补记旧账）；不传则取当前时间 */
  updateExecution: (id: number, data: { executed: boolean; note?: string; executedAt?: string }) =>
    apiClient.put(`/tios/executions/${id}`, data),

  getExecutionStats: () => apiClient.get<any>('/tios/executions/stats'),

  riskReward: (current: number, targetPrice: number, defensePrice: number) =>
    apiClient.post<any>('/tios/risk-reward', { current, targetPrice, defensePrice }),
}

/**
 * 离线快照模式。
 *
 * 网页端原本的链路是 浏览器 → 登录 → Express → MySQL，三个环节任意一个没起来就看不到分析。
 * 而"今天没看"重复三次，系统等于不存在 —— 30 天观察期考的是是否真的每天在用。
 *
 * 离线模式下前端直接读 CLI 盘后落下的 `/data/today.json`（与 CLI、HTML 报告同一份数据）。
 * 有两种进入方式：显式 `VITE_OFFLINE=1`，或接口不可用时自动降级。
 * 自动降级是必要的：让人在后端挂掉时还能看到当天数据，比弹一个报错更有用。
 */
export const OFFLINE_FORCED = import.meta.env.VITE_OFFLINE === '1'
const base = (import.meta.env.BASE_URL ?? '/')
export const OFFLINE_SNAPSHOT_URL = `${base}data/today.json`.replace(/([^:])\/{2,}/g, '$1/')
export const OFFLINE_ENC_URL = `${base}data/today.enc.json`.replace(/([^:])\/{2,}/g, '$1/')

/** 密文快照。需要口令才能解开，故与明文分开表达，不能混成一个"加载失败" */
export interface LockedSnapshot {
  locked: true
  enc: EncryptedSnapshot
}

export function isLocked(x: unknown): x is LockedSnapshot {
  return !!x && typeof x === 'object' && (x as { locked?: unknown }).locked === true
}

/**
 * 取离线快照。**先试密文再试明文。**
 *
 * 顺序是刻意的：部署到公网时目录里只应有密文，但本机开发时可能两者都在。
 * 若先试明文，本机就会静默走明文分支 —— 于是"上线后解密流程有问题"这件事
 * 要等到真的上线才暴露。宁可让本机也走一遍密文路径。
 */
export async function loadOfflineSnapshot(): Promise<any | LockedSnapshot> {
  const enc = await fetchJson(OFFLINE_ENC_URL)
  if (isEncryptedSnapshot(enc)) return { locked: true, enc }
  const plain = await fetchJson(OFFLINE_SNAPSHOT_URL)
  if (plain) return plain
  throw new Error(
    `未找到离线快照（${OFFLINE_ENC_URL} 与 ${OFFLINE_SNAPSHOT_URL} 均不可用）。`
    + ` 先在项目根目录跑一次 npm run web:snapshot 生成它。`
  )
}

/**
 * 取 JSON，取不到就返回 null 而不抛。
 *
 * 必须判 content-type：静态托管的 SPA 回退会把**不存在的文件**当成路由，
 * 返回 200 + index.html。直接 res.json() 得到的是 "Unexpected token <"，
 * 而真正的问题是"文件没生成"或"部署时漏传了" —— 错误信息指向完全错误的方向。
 */
async function fetchJson(url: string): Promise<any | null> {
  try {
    const res = await fetch(url, { cache: 'no-store' })
    if (!res.ok) return null
    if (!(res.headers.get('content-type') ?? '').includes('json')) return null
    return await res.json()
  } catch {
    return null
  }
}

// 每日驾驶舱（六问）
export const cockpitAPI = {
  /** live=true 直连行情源复跑（盘后用），否则优先读库 */
  getToday: (live = false, session?: 'pre' | 'post') => apiClient.get<any>('/cockpit/today', {
    ...(live ? { live: 1 } : {}),
    ...(session === 'pre' ? { session: 'pre' } : {}),
  }),

  /**
   * 取当日驾驶舱，接口不可用时自动降级到离线快照。
   * 返回 `offline` 标记，让页面能明说"你现在看的是快照，不是实时接口"。
   */
  getTodayOrOffline: async (live = false, session?: 'pre' | 'post'): Promise<{
    data: any; offline: boolean; reason: string
  }> => {
    if (OFFLINE_FORCED) {
      return { data: await loadOfflineSnapshot(), offline: true, reason: 'VITE_OFFLINE=1 显式指定离线模式' }
    }
    try {
      return { data: await cockpitAPI.getToday(live, session), offline: false, reason: '' }
    } catch (e: any) {
      const snap = await loadOfflineSnapshot()
      return {
        data: snap,
        offline: true,
        reason: `接口不可用（${e?.message ?? '未知错误'}），已降级读取盘后快照`,
      }
    }
  },

  /** 阈值与口径说明，用于核对规则 */
  getSpec: () => apiClient.get<any>('/cockpit/spec'),

  /** 某日决策审计（Markdown），供三个月后回看 */
  getAudit: (date: string) => apiClient.get<any>(`/cockpit/audit/${date}`),

  /** 审计序列，用于观察 30 个交易日的连续性 */
  getAudits: (limit = 60) => apiClient.get<any[]>('/cockpit/audits', { limit }),
}

// MSR 主线内部轮动雷达
export const msrAPI = {
  getUniverse: () => apiClient.get<any>('/msr/universe'),

  scan: (live = false) => apiClient.post<any>('/msr/scan', { live }),
}

export default apiClient
