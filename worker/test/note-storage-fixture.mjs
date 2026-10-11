/** Async transaction fixture: writes become durable only on transaction completion. */
export function noteStorageFixture() {
  const rows = new Map()
  const control = { rows, failOpen: false, failWrite: false, opens: 0, holdWrites: false, pending: [] }
  control.indexedDB = {
    open() {
      control.opens++
      const request = {}
      queueMicrotask(() => {
        if (control.failOpen) {
          request.error = new Error('IndexedDB open failed')
          request.onerror?.()
          return
        }
        let closed = false
        request.result = {
          close() {
            closed = true
          },
          transaction() {
            if (closed) throw new Error('Database connection closed')
            const transaction = {}
            const mutate = (operation) => {
              const commit = () => {
                if (control.failWrite) {
                  transaction.error = new Error('QuotaExceededError')
                  transaction.onabort?.()
                } else {
                  operation()
                  transaction.oncomplete?.()
                }
              }
              if (control.holdWrites) control.pending.push(commit)
              else queueMicrotask(commit)
            }
            transaction.objectStore = () => ({
              put(row) {
                const copy = structuredClone(row)
                mutate(() => rows.set(copy.key, copy))
              },
              delete(key) {
                mutate(() => rows.delete(key))
              },
              index: () => ({
                getAll(userId) {
                  const read = {}
                  queueMicrotask(() => {
                    read.result = [...rows.values()]
                      .filter((row) => row.userId === userId)
                      .map((row) => structuredClone(row))
                    read.onsuccess?.()
                  })
                  return read
                }
              })
            })
            return transaction
          }
        }
        request.onsuccess?.()
      })
      return request
    }
  }
  return control
}
