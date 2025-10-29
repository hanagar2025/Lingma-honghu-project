import { logger } from '../utils/logger'
import { getConnection } from '../config/database'

export interface UserFeedback {
  feedbackId: string
  userId: string
  type: 'bug' | 'feature' | 'improvement' | 'complaint' | 'praise'
  category: 'ui' | 'performance' | 'functionality' | 'data' | 'other'
  title: string
  description: string
  priority: 'low' | 'medium' | 'high' | 'critical'
  status: 'pending' | 'in_progress' | 'resolved' | 'rejected'
  rating: number
  timestamp: string
}

export interface UserAnalytics {
  userId: string
  sessionDuration: number
  pageViews: number
  featureUsage: Record<string, number>
  userSatisfaction: number
  lastActive: string
  totalSessions: number
}

export interface PersonalizationSettings {
  userId: string
  theme: 'light' | 'dark' | 'auto'
  language: 'zh-CN' | 'en-US'
  notifications: {
    email: boolean
    sms: boolean
    push: boolean
    riskAlerts: boolean
    marketUpdates: boolean
    reportReminders: boolean
  }
  dashboard: {
    layout: 'compact' | 'comfortable' | 'spacious'
    widgets: string[]
    defaultView: 'overview' | 'positions' | 'analysis' | 'reports'
  }
  preferences: {
    riskTolerance: 'low' | 'medium' | 'high'
    investmentStyle: 'conservative' | 'balanced' | 'aggressive'
    timeHorizon: 'short' | 'medium' | 'long'
    focusAreas: string[]
  }
}

export class UserExperienceService {
  // 收集用户反馈
  static async collectFeedback(
    userId: string,
    feedbackData: Omit<UserFeedback, 'feedbackId' | 'userId' | 'timestamp'>
  ): Promise<string> {
    try {
      const feedbackId = `feedback_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
      
      const feedback: UserFeedback = {
        feedbackId,
        userId,
        timestamp: new Date().toISOString(),
        ...feedbackData
      }

      // 保存反馈
      await this.saveFeedback(feedback)
      
      // 如果是高优先级问题，立即通知管理员
      if (feedback.priority === 'critical' || feedback.priority === 'high') {
        await this.notifyAdmins(feedback)
      }

      logger.info(`用户反馈已收集: ${feedbackId}`)
      return feedbackId
    } catch (error) {
      logger.error('收集用户反馈失败:', error)
      throw error
    }
  }

  // 获取用户分析数据
  static async getUserAnalytics(userId: string): Promise<UserAnalytics> {
    try {
      const connection = getConnection()
      
      // 获取用户会话数据
      const [sessions] = await connection.execute(
        'SELECT * FROM user_sessions WHERE user_id = ? ORDER BY created_at DESC LIMIT 30',
        [userId]
      )

      // 计算分析指标
      const sessionDuration = this.calculateAverageSessionDuration(sessions as any[])
      const pageViews = this.calculateTotalPageViews(sessions as any[])
      const featureUsage = this.calculateFeatureUsage(sessions as any[])
      const userSatisfaction = await this.calculateUserSatisfaction(userId)
      const totalSessions = sessions.length
      const lastActive = sessions.length > 0 ? (sessions as any[])[0].created_at : new Date().toISOString()

      return {
        userId,
        sessionDuration,
        pageViews,
        featureUsage,
        userSatisfaction,
        lastActive,
        totalSessions
      }
    } catch (error) {
      logger.error('获取用户分析数据失败:', error)
      throw error
    }
  }

  // 获取个性化设置
  static async getPersonalizationSettings(userId: string): Promise<PersonalizationSettings> {
    try {
      const connection = getConnection()
      const [settings] = await connection.execute(
        'SELECT * FROM user_settings WHERE user_id = ?',
        [userId]
      )

      if (settings && (settings as any[]).length > 0) {
        return JSON.parse((settings as any[])[0].settings_data)
      }

      // 返回默认设置
      return this.getDefaultPersonalizationSettings(userId)
    } catch (error) {
      logger.error('获取个性化设置失败:', error)
      return this.getDefaultPersonalizationSettings(userId)
    }
  }

  // 更新个性化设置
  static async updatePersonalizationSettings(
    userId: string, 
    settings: Partial<PersonalizationSettings>
  ): Promise<void> {
    try {
      const connection = getConnection()
      
      // 获取当前设置
      const currentSettings = await this.getPersonalizationSettings(userId)
      
      // 合并设置
      const updatedSettings = { ...currentSettings, ...settings }
      
      // 保存设置
      await connection.execute(
        'INSERT INTO user_settings (user_id, settings_data, updated_at) VALUES (?, ?, NOW()) ON DUPLICATE KEY UPDATE settings_data = VALUES(settings_data), updated_at = NOW()',
        [userId, JSON.stringify(updatedSettings)]
      )

      logger.info(`用户个性化设置已更新: ${userId}`)
    } catch (error) {
      logger.error('更新个性化设置失败:', error)
      throw error
    }
  }

  // 生成用户体验报告
  static async generateUXReport(): Promise<{
    timestamp: string
    totalUsers: number
    activeUsers: number
    averageSessionDuration: number
    userSatisfaction: number
    topIssues: Array<{ issue: string; count: number }>
    featureUsage: Record<string, number>
    recommendations: string[]
  }> {
    try {
      const connection = getConnection()
      
      // 获取用户统计
      const [userStats] = await connection.execute(
        'SELECT COUNT(*) as total_users, COUNT(CASE WHEN last_login > DATE_SUB(NOW(), INTERVAL 7 DAY) THEN 1 END) as active_users FROM users'
      )
      
      // 获取会话统计
      const [sessionStats] = await connection.execute(
        'SELECT AVG(session_duration) as avg_duration FROM user_sessions WHERE created_at > DATE_SUB(NOW(), INTERVAL 7 DAY)'
      )
      
      // 获取用户满意度
      const [satisfactionStats] = await connection.execute(
        'SELECT AVG(rating) as avg_rating FROM user_feedback WHERE created_at > DATE_SUB(NOW(), INTERVAL 30 DAY)'
      )
      
      // 获取热门问题
      const [topIssues] = await connection.execute(
        'SELECT title, COUNT(*) as count FROM user_feedback WHERE created_at > DATE_SUB(NOW(), INTERVAL 30 DAY) GROUP BY title ORDER BY count DESC LIMIT 5'
      )
      
      // 获取功能使用统计
      const [featureStats] = await connection.execute(
        'SELECT feature_name, COUNT(*) as usage_count FROM feature_usage WHERE created_at > DATE_SUB(NOW(), INTERVAL 7 DAY) GROUP BY feature_name'
      )

      const featureUsage: Record<string, number> = {}
      for (const stat of featureStats as any[]) {
        featureUsage[stat.feature_name] = stat.usage_count
      }

      // 生成建议
      const recommendations = this.generateUXRecommendations(
        userStats as any,
        sessionStats as any,
        satisfactionStats as any,
        topIssues as any[]
      )

      return {
        timestamp: new Date().toISOString(),
        totalUsers: (userStats as any[])[0]?.total_users || 0,
        activeUsers: (userStats as any[])[0]?.active_users || 0,
        averageSessionDuration: (sessionStats as any[])[0]?.avg_duration || 0,
        userSatisfaction: (satisfactionStats as any[])[0]?.avg_rating || 0,
        topIssues: (topIssues as any[]).map(issue => ({
          issue: issue.title,
          count: issue.count
        })),
        featureUsage,
        recommendations
      }
    } catch (error) {
      logger.error('生成用户体验报告失败:', error)
      throw error
    }
  }

  // 跟踪用户行为
  static async trackUserBehavior(
    userId: string,
    action: string,
    data?: any
  ): Promise<void> {
    try {
      const connection = getConnection()
      
      await connection.execute(
        'INSERT INTO user_behavior (user_id, action, data, timestamp) VALUES (?, ?, ?, NOW())',
        [userId, action, JSON.stringify(data || {})]
      )

      // 如果是功能使用，更新功能使用统计
      if (action.startsWith('feature_')) {
        const featureName = action.replace('feature_', '')
        await connection.execute(
          'INSERT INTO feature_usage (user_id, feature_name, created_at) VALUES (?, ?, NOW())',
          [userId, featureName]
        )
      }
    } catch (error) {
      logger.error('跟踪用户行为失败:', error)
    }
  }

  // 保存反馈
  private static async saveFeedback(feedback: UserFeedback): Promise<void> {
    const connection = getConnection()
    await connection.execute(
      'INSERT INTO user_feedback (id, user_id, feedback_type, category, title, description, priority, status, rating, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [
        feedback.feedbackId,
        feedback.userId,
        feedback.type,
        feedback.category,
        feedback.title,
        feedback.description,
        feedback.priority,
        feedback.status,
        feedback.rating,
        feedback.timestamp
      ]
    )
  }

  // 通知管理员
  private static async notifyAdmins(feedback: UserFeedback): Promise<void> {
    logger.warn(`高优先级用户反馈: ${feedback.title} - ${feedback.description}`)
    // 这里可以添加实际的通知逻辑，如发送邮件、短信等
  }

  // 计算平均会话时长
  private static calculateAverageSessionDuration(sessions: any[]): number {
    if (sessions.length === 0) return 0
    
    const totalDuration = sessions.reduce((sum, session) => sum + (session.session_duration || 0), 0)
    return totalDuration / sessions.length
  }

  // 计算总页面浏览量
  private static calculateTotalPageViews(sessions: any[]): number {
    return sessions.reduce((sum, session) => sum + (session.page_views || 0), 0)
  }

  // 计算功能使用情况
  private static calculateFeatureUsage(sessions: any[]): Record<string, number> {
    const usage: Record<string, number> = {}
    
    for (const session of sessions) {
      if (session.feature_usage) {
        const features = JSON.parse(session.feature_usage)
        for (const [feature, count] of Object.entries(features)) {
          usage[feature] = (usage[feature] || 0) + (count as number)
        }
      }
    }
    
    return usage
  }

  // 计算用户满意度
  private static async calculateUserSatisfaction(userId: string): Promise<number> {
    try {
      const connection = getConnection()
      const [ratings] = await connection.execute(
        'SELECT AVG(rating) as avg_rating FROM user_feedback WHERE user_id = ? AND rating > 0',
        [userId]
      )
      
      return (ratings as any[])[0]?.avg_rating || 0
    } catch (error) {
      return 0
    }
  }

  // 获取默认个性化设置
  private static getDefaultPersonalizationSettings(userId: string): PersonalizationSettings {
    return {
      userId,
      theme: 'light',
      language: 'zh-CN',
      notifications: {
        email: true,
        sms: false,
        push: true,
        riskAlerts: true,
        marketUpdates: true,
        reportReminders: true
      },
      dashboard: {
        layout: 'comfortable',
        widgets: ['portfolio', 'market', 'analysis', 'reports'],
        defaultView: 'overview'
      },
      preferences: {
        riskTolerance: 'medium',
        investmentStyle: 'balanced',
        timeHorizon: 'medium',
        focusAreas: ['技术分析', '基本面分析', '风险管理']
      }
    }
  }

  // 生成UX建议
  private static generateUXRecommendations(
    userStats: any,
    sessionStats: any,
    satisfactionStats: any,
    topIssues: any[]
  ): string[] {
    const recommendations: string[] = []

    // 基于用户满意度
    if (satisfactionStats.avg_rating < 3) {
      recommendations.push('用户满意度较低，建议改进核心功能体验')
    }

    // 基于会话时长
    if (sessionStats.avg_duration < 300) { // 5分钟
      recommendations.push('用户会话时长较短，建议优化页面加载速度和内容吸引力')
    }

    // 基于活跃用户比例
    const activeRatio = userStats.active_users / userStats.total_users
    if (activeRatio < 0.3) {
      recommendations.push('用户活跃度较低，建议增加用户粘性功能')
    }

    // 基于热门问题
    if (topIssues.length > 0) {
      recommendations.push(`重点关注用户反馈最多的问题：${topIssues[0].title}`)
    }

    return recommendations
  }
}
