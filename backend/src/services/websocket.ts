import { WebSocketServer } from 'ws'
import { logger } from '../utils/logger'
import { redisUtils } from '../config/redis'

interface WebSocketClient {
  ws: any
  userId: string
  subscriptions: string[]
}

const clients: Map<string, WebSocketClient> = new Map()

export const setupWebSocket = (wss: WebSocketServer): void => {
  wss.on('connection', (ws, req) => {
    logger.info('WebSocket客户端连接')

    ws.on('message', (message) => {
      try {
        const data = JSON.parse(message.toString())
        handleMessage(ws, data)
      } catch (error) {
        logger.error('WebSocket消息解析失败:', error)
        ws.send(JSON.stringify({
          type: 'error',
          message: '消息格式错误'
        }))
      }
    })

    ws.on('close', () => {
      logger.info('WebSocket客户端断开连接')
      // 清理客户端记录
      for (const [userId, client] of clients.entries()) {
        if (client.ws === ws) {
          clients.delete(userId)
          break
        }
      }
    })

    ws.on('error', (error) => {
      logger.error('WebSocket错误:', error)
    })
  })

  // 启动行情推送
  startQuotePush()
}

const handleMessage = (ws: any, data: any): void => {
  const { type, payload } = data

  switch (type) {
    case 'auth':
      handleAuth(ws, payload)
      break
    case 'subscribe':
      handleSubscribe(ws, payload)
      break
    case 'unsubscribe':
      handleUnsubscribe(ws, payload)
      break
    default:
      ws.send(JSON.stringify({
        type: 'error',
        message: '未知消息类型'
      }))
  }
}

const handleAuth = (ws: any, payload: any): void => {
  const { userId, token } = payload
  
  if (!userId || !token) {
    ws.send(JSON.stringify({
      type: 'auth_error',
      message: '认证信息缺失'
    }))
    return
  }

  // TODO: 验证token
  clients.set(userId, {
    ws,
    userId,
    subscriptions: []
  })

  ws.send(JSON.stringify({
    type: 'auth_success',
    message: '认证成功'
  }))

  logger.info(`用户 ${userId} WebSocket认证成功`)
}

const handleSubscribe = (ws: any, payload: any): void => {
  const { userId, codes } = payload
  
  if (!userId || !codes || !Array.isArray(codes)) {
    ws.send(JSON.stringify({
      type: 'error',
      message: '订阅参数错误'
    }))
    return
  }

  const client = clients.get(userId)
  if (!client) {
    ws.send(JSON.stringify({
      type: 'error',
      message: '用户未认证'
    }))
    return
  }

  // 添加订阅
  codes.forEach((code: string) => {
    if (!client.subscriptions.includes(code)) {
      client.subscriptions.push(code)
    }
  })

  ws.send(JSON.stringify({
    type: 'subscribe_success',
    message: '订阅成功',
    codes
  }))

  logger.info(`用户 ${userId} 订阅股票: ${codes.join(', ')}`)
}

const handleUnsubscribe = (ws: any, payload: any): void => {
  const { userId, codes } = payload
  
  const client = clients.get(userId)
  if (!client) {
    return
  }

  // 移除订阅
  if (codes && Array.isArray(codes)) {
    client.subscriptions = client.subscriptions.filter(code => !codes.includes(code))
  } else {
    client.subscriptions = []
  }

  ws.send(JSON.stringify({
    type: 'unsubscribe_success',
    message: '取消订阅成功'
  }))

  logger.info(`用户 ${userId} 取消订阅股票: ${codes?.join(', ') || '全部'}`)
}

// 启动行情推送
const startQuotePush = (): void => {
  setInterval(() => {
    // 获取所有订阅的股票代码
    const allSubscriptions = new Set<string>()
    clients.forEach(client => {
      client.subscriptions.forEach(code => allSubscriptions.add(code))
    })

    if (allSubscriptions.size === 0) {
      return
    }

    // 生成模拟行情数据
    const quotes = Array.from(allSubscriptions).map(code => ({
      code,
      name: `股票${code}`,
      price: Math.random() * 100 + 10,
      change: (Math.random() - 0.5) * 10,
      changeRate: (Math.random() - 0.5) * 10,
      volume: Math.floor(Math.random() * 1000000),
      timestamp: Date.now()
    }))

    // 推送给所有订阅的客户端
    clients.forEach(client => {
      if (client.subscriptions.length > 0) {
        const userQuotes = quotes.filter(quote => 
          client.subscriptions.includes(quote.code)
        )
        
        client.ws.send(JSON.stringify({
          type: 'quote_update',
          data: userQuotes
        }))
      }
    })

    // 发布到Redis频道
    redisUtils.publish('stock_quotes', quotes)
  }, 5000) // 每5秒推送一次
}

// 推送消息给特定用户
export const pushToUser = (userId: string, message: any): void => {
  const client = clients.get(userId)
  if (client && client.ws.readyState === 1) {
    client.ws.send(JSON.stringify(message))
  }
}

// 广播消息给所有用户
export const broadcast = (message: any): void => {
  clients.forEach(client => {
    if (client.ws.readyState === 1) {
      client.ws.send(JSON.stringify(message))
    }
  })
}
