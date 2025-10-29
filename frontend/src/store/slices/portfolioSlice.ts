import { createSlice, createAsyncThunk, PayloadAction } from '@reduxjs/toolkit'
import { portfolioAPI } from '../../services/api'

export interface Position {
  id: string
  stockCode: string
  stockName: string
  quantity: number
  costPrice: number
  currentPrice: number
  marketValue: number
  profitLoss: number
  profitLossRate: number
  positionRatio: number
  category: 'left' | 'right' | 'defensive' | 'observation'
  createdAt: string
  updatedAt: string
}

export interface PortfolioSummary {
  totalAssets: number
  availableCash: number
  totalMarketValue: number
  totalProfitLoss: number
  totalProfitLossRate: number
  leftSideRatio: number
  rightSideRatio: number
  defensiveRatio: number
  observationRatio: number
}

interface PortfolioState {
  positions: Position[]
  summary: PortfolioSummary | null
  loading: boolean
  error: string | null
}

const initialState: PortfolioState = {
  positions: [],
  summary: null,
  loading: false,
  error: null,
}

// 异步actions
export const fetchPositions = createAsyncThunk(
  'portfolio/fetchPositions',
  async () => {
    const response = await portfolioAPI.getPositions()
    return response
  }
)

export const addPosition = createAsyncThunk(
  'portfolio/addPosition',
  async (positionData: Omit<Position, 'id' | 'createdAt' | 'updatedAt'>) => {
    const response = await portfolioAPI.addPosition(positionData)
    console.log('addPosition response:', response)
    // apiClient已经自动提取了data字段，response直接就是数据对象
    return response
  }
)

export const updatePosition = createAsyncThunk(
  'portfolio/updatePosition',
  async ({ id, data }: { id: string; data: Partial<Position> }) => {
    const response = await portfolioAPI.updatePosition(id, data)
    return response
  }
)

export const deletePosition = createAsyncThunk(
  'portfolio/deletePosition',
  async (id: string) => {
    await portfolioAPI.deletePosition(id)
    return id
  }
)

export const fetchPortfolioSummary = createAsyncThunk(
  'portfolio/fetchPortfolioSummary',
  async () => {
    const response = await portfolioAPI.getPortfolioSummary()
    return response
  }
)

const portfolioSlice = createSlice({
  name: 'portfolio',
  initialState,
  reducers: {
    updatePositionPrice: (state, action: PayloadAction<{ stockCode: string; price: number }>) => {
      const { stockCode, price } = action.payload
      const position = state.positions.find(p => p.stockCode === stockCode)
      if (position) {
        position.currentPrice = price
        position.marketValue = position.quantity * price
        position.profitLoss = position.marketValue - (position.quantity * position.costPrice)
        position.profitLossRate = (position.profitLoss / (position.quantity * position.costPrice)) * 100
      }
    },
    clearError: (state) => {
      state.error = null
    },
  },
  extraReducers: (builder) => {
    builder
      // Fetch positions
      .addCase(fetchPositions.pending, (state) => {
        state.loading = true
        state.error = null
      })
      .addCase(fetchPositions.fulfilled, (state, action) => {
        state.loading = false
        state.positions = action.payload.data || action.payload
      })
      .addCase(fetchPositions.rejected, (state, action) => {
        state.loading = false
        state.error = action.error.message || '获取持仓失败'
      })
      // Add position
      .addCase(addPosition.pending, (state) => {
        state.loading = true
        state.error = null
      })
      .addCase(addPosition.fulfilled, (state, action) => {
        state.loading = false
        console.log('addPosition fulfilled, payload:', action.payload)
        // action.payload 现在已经是数据对象了
        state.positions.push(action.payload)
      })
      .addCase(addPosition.rejected, (state, action) => {
        state.loading = false
        state.error = action.error.message || '添加持仓失败'
      })
      // Update position
      .addCase(updatePosition.fulfilled, (state, action) => {
        const updatedPosition = action.payload.data || action.payload
        const index = state.positions.findIndex(p => p.id === updatedPosition.id)
        if (index !== -1) {
          state.positions[index] = updatedPosition
        }
      })
      // Delete position
      .addCase(deletePosition.fulfilled, (state, action) => {
        state.positions = state.positions.filter(p => p.id !== action.payload)
      })
      // Fetch portfolio summary
      .addCase(fetchPortfolioSummary.fulfilled, (state, action) => {
        state.summary = action.payload.data || action.payload
      })
  },
})

export const { updatePositionPrice, clearError } = portfolioSlice.actions
export default portfolioSlice.reducer
