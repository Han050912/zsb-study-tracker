// 兼容旧页面的 primary/slate 类；所有色阶都从已确认的六色源派生。
const alpha = (color) => `color-mix(in srgb, ${color} calc(<alpha-value> * 100%), transparent)`
const mix = (color, percent, other = 'var(--base-surface)') =>
  alpha(`color-mix(in srgb, var(--base-${color}) ${percent}%, ${other})`)

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{vue,ts}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        canvas: alpha('var(--paper)'),
        surface: alpha('var(--surface)'),
        ink: alpha('var(--ink)'),
        muted: alpha('var(--muted)'),
        action: alpha('var(--action)'),
        'action-soft': alpha('var(--action-soft)'),
        'on-action': alpha('var(--on-action)'),
        'surface-soft': alpha('var(--surface-soft)'),
        'correction-soft': alpha('var(--correction-soft)'),
        correction: alpha('var(--correction)'),
        line: alpha('var(--line)'),
        'control-line': alpha('var(--control-line)'),
        primary: {
          50: mix('action', 5),
          100: mix('action', 10),
          200: mix('action', 22),
          300: mix('action', 38),
          400: mix('action', 55),
          500: mix('action', 88),
          600: alpha('var(--base-action)'),
          700: mix('action', 75, 'var(--base-ink)'),
          800: mix('action', 50, 'var(--base-ink)'),
          900: mix('action', 25, 'var(--base-ink)')
        },
        slate: {
          50: alpha('var(--base-canvas)'),
          100: mix('canvas', 65),
          200: mix('muted', 24),
          300: mix('muted', 40),
          400: alpha('var(--muted)'),
          500: alpha('var(--muted)'),
          600: mix('ink', 82),
          700: mix('ink', 92),
          800: alpha('var(--base-ink)'),
          900: mix('ink', 82, 'black'),
          950: mix('ink', 65, 'black')
        }
      },
      fontFamily: {
        display: ['var(--font-display)'],
        body: ['var(--font-body)'],
        data: ['var(--font-data)'],
        sans: ['var(--font-body)']
      },
      borderRadius: { card: 'var(--radius-card)', control: 'var(--radius-control)' },
      boxShadow: { card: 'var(--shadow-card)', raised: 'var(--shadow-raised)' },
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
