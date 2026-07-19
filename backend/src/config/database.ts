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

// TIOS 精简版数据库：7张表覆盖 数据→决策→执行→反馈 完整闭环
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
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `)

    // 持仓表（sector/theme 用于板块30%、主题45%仓位闸门）
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
        profit_loss_rate DECIMAL(8,2) NOT NULL,
        position_ratio DECIMAL(5,2) NOT NULL,
        category VARCHAR(20) NOT NULL DEFAULT 'mainline',
        sector VARCHAR(50) NOT NULL DEFAULT '未分类',
        theme VARCHAR(50) NOT NULL DEFAULT '未分类',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        INDEX idx_user_id (user_id),
        INDEX idx_stock_code (stock_code)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `)

    // 兼容旧库：为已存在的 positions 表补 sector/theme 列，并把旧 ENUM category 放宽为 VARCHAR
    await addColumnIfMissing('positions', 'sector', "VARCHAR(50) NOT NULL DEFAULT '未分类'")
    await addColumnIfMissing('positions', 'theme', "VARCHAR(50) NOT NULL DEFAULT '未分类'")
    await connection.execute("ALTER TABLE positions MODIFY COLUMN category VARCHAR(20) NOT NULL DEFAULT 'mainline'")

    // 日线行情表（真实K线，闭环第①步的数据落库）
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
        turnover DECIMAL(18,2) NOT NULL DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uk_stock_date (stock_code, trade_date),
        INDEX idx_stock_code (stock_code),
        INDEX idx_trade_date (trade_date)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `)

    // 个股规则卡（硬止损/单日熔断/禁买名单，一股一卡）
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS rule_cards (
        user_id VARCHAR(36) NOT NULL,
        stock_code VARCHAR(10) NOT NULL,
        hard_stop_pct DECIMAL(5,4) NOT NULL DEFAULT 0.2500,
        crash_pct DECIMAL(5,4) NOT NULL DEFAULT 0.1200,
        ban_buy TINYINT(1) NOT NULL DEFAULT 0,
        ban_reason VARCHAR(200),
        pending_crash_executions INT NOT NULL DEFAULT 0,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (user_id, stock_code),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `)

    // 账户状态（现金、历史最高净值，用于组合熔断判定）
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS account_state (
        user_id VARCHAR(36) PRIMARY KEY,
        cash DECIMAL(15,2) NOT NULL DEFAULT 0,
        peak_assets DECIMAL(15,2) NOT NULL DEFAULT 0,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `)

    // 盘前四问决策报告（引擎输出留痕，闭环第③步）
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS decision_reports (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        user_id VARCHAR(36) NOT NULL,
        report_date DATE NOT NULL,
        confirmed_stage VARCHAR(20) NOT NULL,
        conclusion VARCHAR(500) NOT NULL,
        report_json JSON NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uk_user_date (user_id, report_date),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `)

    // 执行记录（应执行 vs 实际执行，闭环第④步的反馈与执行率统计）
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS trade_executions (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        user_id VARCHAR(36) NOT NULL,
        report_date DATE NOT NULL,
        stock_code VARCHAR(10) NOT NULL,
        clause VARCHAR(100) NOT NULL,
        required_action VARCHAR(30) NOT NULL,
        executed TINYINT(1) NOT NULL DEFAULT 0,
        note VARCHAR(300),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_user_date (user_id, report_date),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `)

    logger.info('数据库表初始化完成（TIOS精简版：7张表）')
  } catch (error) {
    logger.error('数据库表初始化失败:', error)
    throw error
  }
}

const addColumnIfMissing = async (table: string, column: string, definition: string): Promise<void> => {
  if (!connection) return
  const [rows] = await connection.execute(
    `SELECT COUNT(*) as cnt FROM information_schema.columns
     WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?`,
    [table, column]
  )
  const cnt = (rows as { cnt: number }[])[0]?.cnt ?? 0
  if (cnt === 0) {
    await connection.execute(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
    logger.info(`已为 ${table} 表补充列 ${column}`)
  }
}
