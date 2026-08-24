/**
 * Aho-Corasick 多模式匹配自动机。
 * 用于敏感词检测：对归一化后的文本做 O(n) 多模式匹配，
 * 避免词表规模增大后线性 includes 扫描的 O(n*m) 开销。零依赖。
 */

interface TrieNode {
  children: Map<string, TrieNode>
  fail: TrieNode | null
  output: string | null
}

export class AhoCorasick {
  private root: TrieNode

  constructor(words: readonly string[]) {
    this.root = { children: new Map(), fail: null, output: null }
    this.build(words)
  }

  private build(words: readonly string[]): void {
    // 1. 插入 Trie
    for (const w of words) {
      if (!w) continue
      let node = this.root
      for (const ch of w) {
        let next = node.children.get(ch)
        if (!next) {
          next = { children: new Map(), fail: null, output: null }
          node.children.set(ch, next)
        }
        node = next
      }
      node.output = w
    }

    // 2. BFS 构建失配指针（BFS 保证 fail 指向的节点先于当前节点处理完毕，output 已完整）
    const queue: TrieNode[] = []
    for (const child of this.root.children.values()) {
      child.fail = this.root
      queue.push(child)
    }
    let head = 0
    while (head < queue.length) {
      const node = queue[head++]
      for (const [ch, child] of node.children) {
        queue.push(child)
        let fail = node.fail
        while (fail !== null && !fail.children.has(ch)) {
          fail = fail.fail
        }
        child.fail = fail === null ? this.root : fail.children.get(ch)!
        // 继承 fail 链上的词尾（处理「词是另一词后缀」：词表含 "bc"，文本 "abc" 应命中）
        if (child.output === null && child.fail.output !== null) {
          child.output = child.fail.output
        }
      }
    }
  }

  /** 返回文本中命中的第一个词，无命中返回 null */
  findFirst(text: string): string | null {
    let node = this.root
    for (const ch of text) {
      while (node !== this.root && !node.children.has(ch)) {
        node = node.fail!
      }
      if (node.children.has(ch)) {
        node = node.children.get(ch)!
      }
      if (node.output !== null) return node.output
    }
    return null
  }

  /** 文本是否命中任意词 */
  containsAny(text: string): boolean {
    return this.findFirst(text) !== null
  }
}
