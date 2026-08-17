import ReactDOM from 'react-dom/client'
import { Provider } from 'react-redux'
import { BrowserRouter } from 'react-router-dom'
import { ConfigProvider } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import App from './App.tsx'
import { store } from './store/index.ts'
import ErrorBoundary from './components/ErrorBoundary.tsx'
import './index.css'

// 路由基路径必须跟着构建时的 base 走。
// 挂到 hhwealth.cc/tios/ 这类子路径时若不设 basename，路由会拿 "/tios/" 去匹配
// 声明为 "/" 的路由，匹配不上 → 落到 <Route path="*"> → 无限跳转或空白页，
// 而资源都是 200，看起来像"程序没上传成功"。
// BASE_URL 由 Vite 注入，与 vite.config.ts 的 base 永远一致，不会两处不同步。
const basename = import.meta.env.BASE_URL

ReactDOM.createRoot(document.getElementById('root')!).render(
  <ErrorBoundary>
    <Provider store={store}>
      <BrowserRouter basename={basename}>
        <ConfigProvider locale={zhCN}>
          <App />
        </ConfigProvider>
      </BrowserRouter>
    </Provider>
  </ErrorBoundary>
)
