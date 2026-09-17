/**
 * worker/src/utils/ahoCorasick.ts 纯函数单测（node --test，零依赖模块）。
 * 敏感词检测（sensitive.ts）的底层自动机：多模式 O(n) 匹配。
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import { AhoCorasick } from '../src/utils/ahoCorasick.ts'

test('containsAny: 命中词表中的词（含中文）', () => {
  const ac = new AhoCorasick(['代考', '答案', 'vx'])
  assert.equal(ac.containsAny('这题有代考服务'), true)
  assert.equal(ac.containsAny('卖答案的别来'), true)
  assert.equal(ac.containsAny('好好学习天天向上'), false)
})

test('findFirst: 返回命中的第一个词，无命中返回 null', () => {
  const ac = new AhoCorasick(['代考', '答案'])
  assert.equal(ac.findFirst('先卖答案再找代考'), '答案')
  assert.equal(ac.findFirst('好好学习'), null)
})

test('containsAny: 词是另一词后缀时也能命中（fail 链词尾继承）', () => {
  // 词表含 bc，文本 abc：失配指针须把 bc 的词尾继承到 abc 路径上
  const ac = new AhoCorasick(['bc'])
  assert.equal(ac.containsAny('abc'), true)
  assert.equal(ac.findFirst('abc'), 'bc')
})

test('containsAny: 部分前缀不构成命中', () => {
  const ac = new AhoCorasick(['代考'])
  assert.equal(ac.containsAny('代人收快递'), false)
  assert.equal(ac.containsAny('考虑再三'), false)
})

test('构造: 空词表与空词被安全忽略', () => {
  const empty = new AhoCorasick([])
  assert.equal(empty.containsAny('任意文本'), false)
  const withEmpty = new AhoCorasick(['', '代考'])
  assert.equal(withEmpty.containsAny('代考'), true)
  assert.equal(withEmpty.containsAny('无关文本'), false)
})

test('containsAny: 重叠与相邻命中', () => {
  const ac = new AhoCorasick(['abc', 'bcd', 'cde'])
  assert.equal(ac.containsAny('abcde'), true)
  assert.equal(ac.findFirst('abcde'), 'abc')
  assert.equal(ac.containsAny('abde'), false)
})
