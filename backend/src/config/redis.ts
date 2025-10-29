import { createClient } from 'redis'
import { logger } from '../utils/logger'

let redisClient: ReturnType<typeof createClient> | null = null

export const connectRedis = async (): Promise<void> => {
  try {
    redisClient = createClient({
      url: process.env.REDIS_URL || 'redis://localhost:6379',
      socket: {
        reconnectStrategy: (retries) => Math.min(retries * 50, 500)
      }
    })

    redisClient.on('error', (err) => {
      logger.error('Redis连接错误:', err)
    })

    redisClient.on('connect', () => {
      logger.info('Redis连接成功')
    })

    await redisClient.connect()
  } catch (error) {
    logger.error('Redis连接失败:', error)
    throw error
  }
}

export const getRedisClient = () => {
  if (!redisClient) {
    throw new Error('Redis未连接')
  }
  return redisClient
}

// Redis工具函数
export const redisUtils = {
  // 设置缓存
  async set(key: string, value: any, ttl?: number): Promise<void> {
    const client = getRedisClient()
    const serialized = JSON.stringify(value)
    if (ttl) {
      await client.setEx(key, ttl, serialized)
    } else {
      await client.set(key, serialized)
    }
  },

  // 获取缓存
  async get<T>(key: string): Promise<T | null> {
    const client = getRedisClient()
    const value = await client.get(key)
    if (value) {
      return JSON.parse(value)
    }
    return null
  },

  // 删除缓存
  async del(key: string): Promise<void> {
    const client = getRedisClient()
    await client.del(key)
  },

  // 设置过期时间
  async expire(key: string, ttl: number): Promise<void> {
    const client = getRedisClient()
    await client.expire(key, ttl)
  },

  // 检查键是否存在
  async exists(key: string): Promise<boolean> {
    const client = getRedisClient()
    const result = await client.exists(key)
    return result === 1
  },

  // 获取所有匹配的键
  async keys(pattern: string): Promise<string[]> {
    const client = getRedisClient()
    return await client.keys(pattern)
  },

  // 发布消息
  async publish(channel: string, message: any): Promise<void> {
    const client = getRedisClient()
    await client.publish(channel, JSON.stringify(message))
  },

  // 订阅消息
  async subscribe(channel: string, callback: (message: any) => void): Promise<void> {
    const client = getRedisClient()
    await client.subscribe(channel, (message) => {
      try {
        const parsed = JSON.parse(message)
        callback(parsed)
      } catch (error) {
        logger.error('解析Redis消息失败:', error)
      }
    })
  }
}
