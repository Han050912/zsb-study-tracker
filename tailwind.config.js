/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{vue,ts}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        primary: {
          50: '#eff6ff',
          100: '#dbeafe',
          200: '#bfdbfe',
          300: '#93c5fd',
          400: '#60a5fa',
          500: '#3b82f6',
          600: '#2563eb',
          700: '#1d4ed8',
          800: '#1e40af',
          900: '#1e3a8a'
        }
      },
      // iOS 安全区（viewport-fit=cover）单点定义：env(safe-area-inset-*) 只在此处出现，
      // 组件侧一律使用语义化类名（top-header-top / pt-content-top / pb-safe-bottom …），不散落 magic number。
      spacing: {
        'safe-top': 'env(safe-area-inset-top)',
        'safe-bottom': 'env(safe-area-inset-bottom)',
        'safe-left': 'env(safe-area-inset-left)',
        'safe-right': 'env(safe-area-inset-right)',
        // 右上角悬浮入口（原 top-3 / right-4）推到状态栏 / 刘海外侧
        'header-top': 'calc(env(safe-area-inset-top) + 0.75rem)',
        'header-right': 'calc(env(safe-area-inset-right) + 1rem)',
        // 主内容顶部预留（原 pt-14 = 3.5rem，让开悬浮入口）+ 顶部安全区
        'content-top': 'calc(env(safe-area-inset-top) + 3.5rem)',
        // 移动端主内容底部预留（原 pb-20 = 5rem，让开底部导航）+ 底部安全区
        'content-bottom': 'calc(5rem + env(safe-area-inset-bottom))'
      }
    }
  },
  plugins: []
}
