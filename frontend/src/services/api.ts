/// <reference types="vite/client" />
import axios, { AxiosInstance, AxiosResponse } from 'axios'

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

// 每日驾驶舱（六问）
export const cockpitAPI = {
  /** live=true 直连行情源复跑（盘后用），否则优先读库 */
  getToday: (live = false, session?: 'pre' | 'post') => apiClient.get<any>('/cockpit/today', {
    ...(live ? { live: 1 } : {}),
    ...(session === 'pre' ? { session: 'pre' } : {}),
  }),

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
