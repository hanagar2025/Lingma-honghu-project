import axios, { AxiosInstance, AxiosResponse } from 'axios'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000/api'

class APIClient {
  private client: AxiosInstance

  constructor() {
    this.client = axios.create({
      baseURL: API_BASE_URL,
      timeout: 10000,
      headers: {
        'Content-Type': 'application/json',
      },
    })

    // 请求拦截器
    this.client.interceptors.request.use(
      (config) => {
        const token = localStorage.getItem('token')
        if (token) {
          config.headers.Authorization = `Bearer ${token}`
        }
        return config
      },
      (error) => {
        return Promise.reject(error)
      }
    )

    // 响应拦截器
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

  // 统一提取data字段的辅助方法
  private extractData<T>(responseData: any): T {
    // 如果返回格式是 { success: true, data: {...} }
    if (responseData && typeof responseData === 'object' && 'success' in responseData && 'data' in responseData) {
      return responseData.data
    }
    return responseData
  }

  async get<T>(url: string, params?: any): Promise<T> {
    const response: AxiosResponse<T> = await this.client.get(url, { params })
    return this.extractData<T>(response.data)
  }
  
  // 便捷方法：直接拼接查询参数
  async getWithQuery<T>(url: string, queryParams?: Record<string, any>): Promise<T> {
    const queryString = queryParams ? new URLSearchParams(queryParams).toString() : ''
    const fullUrl = queryString ? `${url}?${queryString}` : url
    const response: AxiosResponse<T> = await this.client.get(fullUrl)
    return this.extractData<T>(response.data)
  }

  async post<T>(url: string, data?: any, config?: any): Promise<T> {
    const response: AxiosResponse<T> = await this.client.post(url, data, config)
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

// 认证相关API
export const authAPI = {
  login: (credentials: { username: string; password: string }) =>
    apiClient.post('/auth/login', credentials),
  
  register: (userData: { username: string; email: string; password: string }) =>
    apiClient.post('/auth/register', userData),
  
  getProfile: () =>
    apiClient.get('/auth/profile'),
  
  logout: () =>
    apiClient.post('/auth/logout'),
}

// 持仓相关API
export const portfolioAPI = {
  getPositions: () =>
    apiClient.get('/portfolio/positions'),
  
  addPosition: (positionData: any) =>
    apiClient.post('/portfolio/positions', positionData),
  
  updatePosition: (id: string, data: any) =>
    apiClient.put(`/portfolio/positions/${id}`, data),
  
  deletePosition: (id: string) =>
    apiClient.delete(`/portfolio/positions/${id}`),
  
  getPortfolioSummary: () =>
    apiClient.get('/portfolio/summary'),
  
  importPositions: (file: File) => {
    const formData = new FormData()
    formData.append('file', file)
    return apiClient.post('/portfolio/import', formData, {
      headers: { 'Content-Type': 'multipart/form-data' }
    })
  },
}

// 市场数据API
export const marketAPI = {
  getStockQuotes: (stockCodes: string[]) =>
    apiClient.post('/market/quotes', { codes: stockCodes }),
  
  getMarketIndices: () =>
    apiClient.get('/market/indices'),
  
  subscribeToQuotes: (stockCodes: string[]) =>
    apiClient.post('/market/subscribe', { codes: stockCodes }),
  
  getStockInfo: (stockCode: string) =>
    apiClient.get(`/market/stocks/${stockCode}`),
  
  getStockHistory: (stockCode: string, period: string) =>
    apiClient.get(`/market/stocks/${stockCode}/history`, { params: { period } }),
  
  searchStockByName: (name: string) =>
    apiClient.getWithQuery('/market/search', { name }),
}

// 分析相关API
export const analysisAPI = {
  getTechnicalAnalysis: (stockCode: string) =>
    apiClient.get(`/analysis/technical/${stockCode}`),
  
  getFundamentalAnalysis: (stockCode: string) =>
    apiClient.get(`/analysis/fundamental/${stockCode}`),
  
  getPositionAnalysis: () =>
    apiClient.get('/analysis/positions'),
  
  getRecommendations: () =>
    apiClient.get('/analysis/recommendations'),
}

// 报表相关API
export const reportsAPI = {
  getDailyReports: (date?: string) =>
    apiClient.get('/reports/daily', { params: { date } }),
  
  generateReport: (type: string) =>
    apiClient.post('/reports/generate', { type }),
  
  getReportHistory: () =>
    apiClient.get('/reports/history'),
}

// 板块相关API
export const sectorAPI = {
  getSectors: () =>
    apiClient.get('/sector/sectors'),
  
  getHotSectors: () =>
    apiClient.get('/sector/hot-sectors'),
  
  getSectorRotation: () =>
    apiClient.get('/sector/rotation'),
  
  getPolicyNews: () =>
    apiClient.get('/sector/policy-news'),
  
  getPolicyImpact: () =>
    apiClient.get('/sector/policy-impact'),
  
  getSectorCorrelation: (sector1: string, sector2: string) =>
    apiClient.get('/sector/correlation', { params: { sector1, sector2 } }),
}

// 决策相关API
export const decisionsAPI = {
  generateDecision: (timeHorizon: string) =>
    apiClient.post('/decisions/generate', { timeHorizon }),
  
  getDecisionHistory: (params?: any) =>
    apiClient.get('/decisions/history', { params }),
  
  getDecisionDetail: (decisionId: string) =>
    apiClient.get(`/decisions/${decisionId}`),
  
  executeDecision: (decisionId: string, action: any) =>
    apiClient.post(`/decisions/${decisionId}/execute`, action),
  
  getDecisionStats: () =>
    apiClient.get('/decisions/stats/overview'),
}

// 系统相关API
export const systemAPI = {
  getRiskData: () =>
    apiClient.get('/system/risk'),
  
  getMetrics: () =>
    apiClient.get('/system/metrics'),
  
  getHealth: () =>
    apiClient.get('/system/health'),
  
  getOptimization: () =>
    apiClient.get('/system/optimization'),
  
  executeOptimization: (optimizationId: string) =>
    apiClient.post('/system/optimization/execute', { optimizationId }),
  
  getSystemReport: () =>
    apiClient.get('/system/report'),
  
  submitFeedback: (feedback: any) =>
    apiClient.post('/system/feedback', feedback),
  
  getAnalytics: () =>
    apiClient.get('/system/analytics'),
  
  getSettings: () =>
    apiClient.get('/system/settings'),
  
  updateSettings: (settings: any) =>
    apiClient.put('/system/settings', settings),
  
  trackBehavior: (action: string, data?: any) =>
    apiClient.post('/system/track', { action, data }),
  
  getUXReport: () =>
    apiClient.get('/system/ux-report'),
}

// 智能仓位推荐API
export const smartRecommendationAPI = {
  // 生成单个股票的仓位推荐
  getRecommendation: (stockCode: string) =>
    apiClient.post(`/smart-recommendation/recommend/${stockCode}`),
  
  // 批量生成推荐
  getBatchRecommendations: (stockCodes: string[]) =>
    apiClient.post('/smart-recommendation/batch', { stockCodes }),
  
  // 获取推荐股票池
  getStockPool: () =>
    apiClient.get('/smart-recommendation/stock-pool'),
  
  // 获取推荐概览
  getOverview: () =>
    apiClient.get('/smart-recommendation/overview'),
}

// 组合策略API
export const portfolioStrategyAPI = {
  // 获取所有策略主题
  getThemes: () =>
    apiClient.get('/portfolio-strategy/themes'),
  
  // 生成组合策略
  generateStrategy: (params: any) =>
    apiClient.post('/portfolio-strategy/generate', params),
  
  // 获取智能推荐组合
  getRecommendedPortfolio: (params: any) =>
    apiClient.post('/portfolio-strategy/recommend', params),
}

export default apiClient
