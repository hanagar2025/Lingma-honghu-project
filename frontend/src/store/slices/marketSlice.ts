import { createSlice, createAsyncThunk, PayloadAction } from '@reduxjs/toolkit'
import { marketAPI } from '../../services/api'

export interface StockQuote {
  code: string
  name: string
  price: number
  change: number
  changeRate: number
  volume: number
  turnover: number
  high: number
  low: number
  open: number
  prevClose: number
  timestamp: number
}

export interface MarketIndex {
  code: string
  name: string
  value: number
  change: number
  changeRate: number
}

interface MarketState {
  quotes: Record<string, StockQuote>
  indices: MarketIndex[]
  loading: boolean
  error: string | null
  lastUpdate: number | null
}

const initialState: MarketState = {
  quotes: {},
  indices: [],
  loading: false,
  error: null,
  lastUpdate: null,
}

// 异步actions
export const fetchStockQuotes = createAsyncThunk(
  'market/fetchStockQuotes',
  async (stockCodes: string[]) => {
    const response = await marketAPI.getStockQuotes(stockCodes)
    return response
  }
)

export const fetchMarketIndices = createAsyncThunk(
  'market/fetchMarketIndices',
  async () => {
    const response = await marketAPI.getMarketIndices()
    return response
  }
)

export const subscribeToQuotes = createAsyncThunk(
  'market/subscribeToQuotes',
  async (stockCodes: string[]) => {
    const response = await marketAPI.subscribeToQuotes(stockCodes)
    return response
  }
)

const marketSlice = createSlice({
  name: 'market',
  initialState,
  reducers: {
    updateQuote: (state, action: PayloadAction<StockQuote>) => {
      const quote = action.payload
      state.quotes[quote.code] = quote
      state.lastUpdate = Date.now()
    },
    updateQuotes: (state, action: PayloadAction<StockQuote[]>) => {
      action.payload.forEach(quote => {
        state.quotes[quote.code] = quote
      })
      state.lastUpdate = Date.now()
    },
    clearError: (state) => {
      state.error = null
    },
  },
  extraReducers: (builder) => {
    builder
      // Fetch stock quotes
      .addCase(fetchStockQuotes.pending, (state) => {
        state.loading = true
        state.error = null
      })
      .addCase(fetchStockQuotes.fulfilled, (state, action) => {
        state.loading = false
        const quotes = action.payload.data || action.payload
        quotes.forEach((quote: any) => {
          state.quotes[quote.code] = quote
        })
        state.lastUpdate = Date.now()
      })
      .addCase(fetchStockQuotes.rejected, (state, action) => {
        state.loading = false
        state.error = action.error.message || '获取行情失败'
      })
      // Fetch market indices
      .addCase(fetchMarketIndices.fulfilled, (state, action) => {
        state.indices = action.payload.data || action.payload
      })
  },
})

export const { updateQuote, updateQuotes, clearError } = marketSlice.actions
export default marketSlice.reducer
