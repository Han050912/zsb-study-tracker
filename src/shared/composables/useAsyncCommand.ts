import { ref } from 'vue'
import { getErrorMessage } from '../../utils/error'

/** 一次命令只允许一个在途请求，错误留在原操作旁供重试。实例由所属区域持有。 */
export function useAsyncCommand<T = void>(key: string) {
  const pending = ref(false),
    error = ref('')
  let active: Promise<T> | null = null
  function run(command: () => Promise<T>): Promise<T> {
    if (active) return active
    pending.value = true
    error.value = ''
    active = Promise.resolve()
      .then(command)
      .catch((e) => {
        error.value = getErrorMessage(e, '操作失败，请重试')
        throw e
      })
      .finally(() => {
        pending.value = false
        active = null
      })
    return active
  }
  return { key, pending, error, run }
}
