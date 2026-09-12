// ESLint 只做静态质量检查；代码格式由 Prettier 负责（见 .prettierrc.json）
import js from '@eslint/js'
import pluginVue from 'eslint-plugin-vue'
import tseslint from 'typescript-eslint'
import globals from 'globals'
import prettierConfig from 'eslint-config-prettier'

export default tseslint.config(
  {
    // 构建产物、依赖、文档与静态资源不参与 lint
    ignores: [
      'dist/**',
      'release/**',
      '**/node_modules/**',
      'worker/.wrangler/**',
      'public/**',
      'docs/**',
      // 工具生成的工作目录（已被 .gitignore 忽略），不参与 lint
      '.superpowers/**',
      '.codebuddy/**'
    ]
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...pluginVue.configs['flat/essential'],
  prettierConfig,
  {
    rules: {
      // 已有 242 处历史 any：降为 warning，保持可见但不阻塞门禁，后续增量治理
      '@typescript-eslint/no-explicit-any': 'warn',
      // 允许用下划线前缀显式标注「有意不使用的参数/变量」（如路由 handler 的占位参数）
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      // 项目组件命名约定为单词名（Modal / Toast / Heatmap 等），不强制多词
      'vue/multi-word-component-names': 'off'
    }
  },
  {
    // 后端（Worker）跑在 Node/Workerd 环境，且未定义标识符由 worker 的 tsc 负责
    files: ['worker/**/*.{ts,mjs,js}'],
    languageOptions: { globals: { ...globals.node } },
    rules: { 'no-undef': 'off' }
  },
  {
    // 前端 .vue 单文件组件：未定义标识符由 vue-tsc 负责（含 vite define 注入的编译期常量）
    files: ['**/*.vue'],
    languageOptions: {
      parserOptions: { parser: tseslint.parser },
      globals: { ...globals.browser }
    },
    rules: { 'no-undef': 'off' }
  },
  {
    // 前端源码跑在浏览器环境；根级配置文件（vite.config.ts 等）不走这条
    files: ['src/**/*.{ts,vue}'],
    languageOptions: { globals: { ...globals.browser } }
  },
  {
    // Electron 主进程/预加载是 CommonJS 入口，必须使用 require
    files: ['**/*.cjs', '**/*.js'],
    languageOptions: { globals: { ...globals.node } },
    rules: { '@typescript-eslint/no-require-imports': 'off' }
  }
)
