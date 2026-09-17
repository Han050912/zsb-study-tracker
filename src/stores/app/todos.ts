/**
 * app store 的 todos 域模块：待办 CRUD、提醒时间、完成积分与拖拽排序。
 * 仅 import staging 纯函数与 services；不 import 其他 app 域模块的 actions（跨域调用一律走 this）。
 */

import type { AppStoreThis } from './this-type'
import { uid, today } from '../../utils/date'
import { stageDelete } from '../../services/syncOutbox'
import { touchRecord } from './staging'
import type { Todo } from '../../types'

/** 显式签名（不含 this 参数）：断开 AppStoreThis 与字面量推断的类型循环，原理见 sync.ts 顶部注释 */
type TodosActionsShape = {
  addTodo(text: string, schedule?: { startAt?: number; dueAt?: number }): void
  setTodoSchedule(id: string, schedule: { startAt?: number | null; dueAt?: number | null }): void
  markTodosNotified(ids: string[], kind: 'start' | 'due'): void
  toggleTodo(id: string): void
  deleteTodo(id: string): void
  reorderTodos(orderedIds: string[]): void
}

export const todosActions: TodosActionsShape = {
  /** 新增待办；可同时指定开始时间与最晚截止时间（时间戳），到点由提醒调度器弹通知 */
  addTodo(this: AppStoreThis, text: string, schedule?: { startAt?: number; dueAt?: number }) {
    const maxOrder = Math.max(0, ...this.todayTodos.map((t) => t.order))
    const todo: Todo = { id: uid(), date: today(), text, done: false, order: maxOrder + 1 }
    if (schedule?.startAt) todo.startAt = schedule.startAt
    if (schedule?.dueAt) todo.dueAt = schedule.dueAt
    this.todos.push(todo)
    touchRecord('todos', todo)
    this.save()
  },

  /**
   * 设置待办的开始 / 最晚截止时间（传 null 清除）。
   * 时间被改动即清除对应的提醒去重标记，使新时间到点时重新提醒。
   */
  setTodoSchedule(this: AppStoreThis, id: string, schedule: { startAt?: number | null; dueAt?: number | null }) {
    const t = this.todos.find((x) => x.id === id)
    if (!t) return
    if ('startAt' in schedule) {
      if (schedule.startAt) t.startAt = schedule.startAt
      else delete t.startAt
      delete t.startNotifiedAt
    }
    if ('dueAt' in schedule) {
      if (schedule.dueAt) t.dueAt = schedule.dueAt
      else delete t.dueAt
      delete t.dueNotifiedAt
    }
    touchRecord('todos', t)
    this.save()
  },

  /** 记录提醒已发出（供提醒调度器回调），避免下次轮询重复提醒 */
  markTodosNotified(this: AppStoreThis, ids: string[], kind: 'start' | 'due') {
    const now = Date.now()
    for (const id of ids) {
      const t = this.todos.find((x) => x.id === id)
      if (!t) continue
      if (kind === 'start') t.startNotifiedAt = now
      else t.dueNotifiedAt = now
      touchRecord('todos', t, now)
    }
    this.save()
  },

  /** 切换待办完成状态；完成时记录完成时间并奖励积分，取消完成回收积分并清除完成时间 */
  toggleTodo(this: AppStoreThis, id: string) {
    const t = this.todos.find((x) => x.id === id)
    if (!t) return
    t.done = !t.done
    if (t.done) {
      t.completedAt = Date.now()
      this.addPoints(3, '完成待办', t.id)
    } else {
      delete t.completedAt
      // 取消完成为非删除场景：todos 域服务端无删除自动撤销 → 必须显式发 revoke 事件
      this.revokePointsByRef(t.id, true)
    }
    touchRecord('todos', t)
    this.save()
  },

  deleteTodo(this: AppStoreThis, id: string) {
    // 删除已完成待办时回收其积分；todos 域服务端无删除自动撤销 → 显式发 revoke 事件
    this.revokePointsByRef(id, true)
    const t = this.todos.find((x) => x.id === id)
    this.todos = this.todos.filter((x) => x.id !== id)
    if (t) stageDelete('todos', id, Date.now())
    this.save()
  },

  /**
   * 按拖拽后得到的新顺序排列今日待办：重新分配 order 并去重保存。
   * orderedIds 为拖拽结束后期望的顺序（仅今日待办 id）；未在列表中的今日待办保持原位追加在末尾。
   */
  reorderTodos(this: AppStoreThis, orderedIds: string[]) {
    const list = this.todayTodos
    const byId = new Map(list.map((t) => [t.id, t]))
    let order = 1
    const seen = new Set<string>()
    const touched = new Set<string>()
    for (const id of orderedIds) {
      const t = byId.get(id)
      if (t) {
        t.order = order++
        seen.add(id)
        touched.add(id)
      }
    }
    // 兜底：列表中存在但未被传入的今日待办，按原顺序追加在末尾
    for (const t of list) {
      if (!seen.has(t.id)) {
        t.order = order++
        touched.add(t.id)
      }
    }
    // 顺序变动过的待办逐条打点
    for (const id of touched) {
      const t = this.todos.find((x) => x.id === id)
      if (t) touchRecord('todos', t)
    }
    this.save()
  }
}
