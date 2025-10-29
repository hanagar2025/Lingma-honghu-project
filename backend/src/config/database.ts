import mysql from 'mysql2/promise'
import { logger } from '../utils/logger'

let connection: mysql.Connection | null = null

export const connectDB = async (): Promise<void> => {
  try {
    const dbHost = process.env.DB_HOST || '127.0.0.1'
    connection = await mysql.createConnection({
      host: dbHost,
      port: parseInt(process.env.DB_PORT || '3306'),
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || '',
      database: process.env.DB_NAME || 'stock_decision',
      charset: 'utf8mb4',
      timezone: '+08:00',
    })

    logger.info('MySQL数据库连接成功')
    
    // 初始化数据库表
    await initTables()
  } catch (error) {
    logger.error('数据库连接失败:', error)
    throw error
  }
}

export const getConnection = (): mysql.Connection => {
  if (!connection) {
    throw new Error('数据库未连接')
  }
  return connection
}

// 初始化数据库表
const initTables = async (): Promise<void> => {
  if (!connection) return

  try {
    // 用户表
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS users (
        id VARCHAR(36) PRIMARY KEY,
        username VARCHAR(50) UNIQUE NOT NULL,
        email VARCHAR(100) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        avatar VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `)

    // 持仓表
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS positions (
        id VARCHAR(36) PRIMARY KEY,
        user_id VARCHAR(36) NOT NULL,
        stock_code VARCHAR(10) NOT NULL,
        stock_name VARCHAR(50) NOT NULL,
        quantity INT NOT NULL,
        cost_price DECIMAL(10,2) NOT NULL,
        current_price DECIMAL(10,2) NOT NULL,
        market_value DECIMAL(15,2) NOT NULL,
        profit_loss DECIMAL(15,2) NOT NULL,
        profit_loss_rate DECIMAL(5,2) NOT NULL,
        position_ratio DECIMAL(5,2) NOT NULL,
        category ENUM('left', 'right', 'defensive', 'observation') NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        INDEX idx_user_id (user_id),
        INDEX idx_stock_code (stock_code)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `)

    // 股票基本信息表
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS stock_info (
        code VARCHAR(10) PRIMARY KEY,
        name VARCHAR(50) NOT NULL,
        industry VARCHAR(50),
        market VARCHAR(20),
        list_date DATE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `)

    // 日线行情表
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS stock_daily (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        stock_code VARCHAR(10) NOT NULL,
        trade_date DATE NOT NULL,
        open_price DECIMAL(10,2) NOT NULL,
        high_price DECIMAL(10,2) NOT NULL,
        low_price DECIMAL(10,2) NOT NULL,
        close_price DECIMAL(10,2) NOT NULL,
        volume BIGINT NOT NULL,
        turnover DECIMAL(15,2) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uk_stock_date (stock_code, trade_date),
        INDEX idx_stock_code (stock_code),
        INDEX idx_trade_date (trade_date)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `)

    // 基本面数据表
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS stock_fundamentals (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        stock_code VARCHAR(10) NOT NULL,
        report_date DATE NOT NULL,
        pe_ratio DECIMAL(8,2),
        pb_ratio DECIMAL(8,2),
        roe DECIMAL(8,2),
        revenue DECIMAL(15,2),
        net_profit DECIMAL(15,2),
        total_assets DECIMAL(15,2),
        total_liabilities DECIMAL(15,2),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uk_stock_report (stock_code, report_date),
        INDEX idx_stock_code (stock_code),
        INDEX idx_report_date (report_date)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `)

    // 用户设置表
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS user_settings (
        id VARCHAR(36) PRIMARY KEY,
        user_id VARCHAR(36) NOT NULL,
        price_alert BOOLEAN DEFAULT TRUE,
        technical_alert BOOLEAN DEFAULT TRUE,
        report_email BOOLEAN DEFAULT TRUE,
        report_sms BOOLEAN DEFAULT FALSE,
        max_position_ratio DECIMAL(5,2) DEFAULT 10.00,
        stop_loss_ratio DECIMAL(5,2) DEFAULT 5.00,
        take_profit_ratio DECIMAL(5,2) DEFAULT 20.00,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        UNIQUE KEY uk_user_id (user_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `)

    // 报表任务表
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS report_tasks (
        id VARCHAR(36) PRIMARY KEY,
        user_id VARCHAR(36) NOT NULL,
        task_type VARCHAR(50) NOT NULL,
        status ENUM('pending', 'running', 'completed', 'failed') DEFAULT 'pending',
        scheduled_time TIME NOT NULL,
        last_run TIMESTAMP NULL,
        next_run TIMESTAMP NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        INDEX idx_user_id (user_id),
        INDEX idx_scheduled_time (scheduled_time)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `)

    logger.info('数据库表初始化完成')
  } catch (error) {
    logger.error('数据库表初始化失败:', error)
    throw error
  }
}
