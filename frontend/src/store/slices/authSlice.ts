import { createSlice, createAsyncThunk, PayloadAction } from '@reduxjs/toolkit'
import { authAPI } from '../../services/api'

interface User {
  id: string
  username: string
  email: string
  avatar?: string
}

interface AuthState {
  user: User | null
  token: string | null
  isAuthenticated: boolean
  loading: boolean
  error: string | null
}

// 从localStorage恢复用户信息
const savedUser = localStorage.getItem('user')
const initialUser = savedUser ? JSON.parse(savedUser) : null

const initialState: AuthState = {
  user: initialUser,
  token: localStorage.getItem('token'),
  isAuthenticated: !!localStorage.getItem('token') && !!initialUser,
  loading: false,
  error: null,
}

// 异步actions
export const login = createAsyncThunk(
  'auth/login',
  async (credentials: { username: string; password: string }) => {
    const response = await authAPI.login(credentials)
    console.log('login response:', response)
    // apiClient已经自动提取了data字段，response直接就是数据对象
    localStorage.setItem('token', response.token)
    return response
  }
)

export const register = createAsyncThunk(
  'auth/register',
  async (userData: { username: string; email: string; password: string }) => {
    const response = await authAPI.register(userData)
    console.log('register response:', response)
    // apiClient已经自动提取了data字段，response直接就是数据对象
    localStorage.setItem('token', response.token)
    return response
  }
)

export const logout = createAsyncThunk(
  'auth/logout',
  async () => {
    localStorage.removeItem('token')
    return null
  }
)

export const fetchUserProfile = createAsyncThunk(
  'auth/fetchUserProfile',
  async () => {
    const response = await authAPI.getProfile()
    return response
  }
)

const authSlice = createSlice({
  name: 'auth',
  initialState,
  reducers: {
    clearError: (state) => {
      state.error = null
    },
  },
  extraReducers: (builder) => {
    builder
      // Login
      .addCase(login.pending, (state) => {
        state.loading = true
        state.error = null
      })
      .addCase(login.fulfilled, (state, action) => {
        state.loading = false
        console.log('login fulfilled, payload:', action.payload)
        state.user = action.payload.user
        state.token = action.payload.token
        state.isAuthenticated = true
        // 持久化用户信息
        localStorage.setItem('user', JSON.stringify(action.payload.user))
      })
      .addCase(login.rejected, (state, action) => {
        state.loading = false
        state.error = action.error.message || '登录失败'
      })
      // Register
      .addCase(register.pending, (state) => {
        state.loading = true
        state.error = null
      })
      .addCase(register.fulfilled, (state, action) => {
        state.loading = false
        console.log('register fulfilled, payload:', action.payload)
        state.user = action.payload.user
        state.token = action.payload.token
        state.isAuthenticated = true
        // 持久化用户信息
        localStorage.setItem('user', JSON.stringify(action.payload.user))
      })
      .addCase(register.rejected, (state, action) => {
        state.loading = false
        state.error = action.error.message || '注册失败'
      })
      // Logout
      .addCase(logout.fulfilled, (state) => {
        state.user = null
        state.token = null
        state.isAuthenticated = false
        state.loading = false
        state.error = null
        // 清除持久化数据
        localStorage.removeItem('token')
        localStorage.removeItem('user')
      })
      // Fetch user profile
      .addCase(fetchUserProfile.fulfilled, (state, action) => {
        state.user = action.payload
      })
  },
})

export const { clearError } = authSlice.actions
export default authSlice.reducer
