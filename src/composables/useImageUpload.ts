import { computed, onUnmounted, ref } from 'vue'
import { uploadImage, IMAGE_MAX_BYTES } from '../api/community'
import { getErrorMessage } from '../utils/error'
import { useToast } from './useToast'

/** 待发送图片：本地预览 → 上传中进度 → 服务端路径 / 失败重试 */
export interface PendingImage {
  /** 本地预览地址（blob:） */
  localUrl: string
  file?: File
  /** 上传完成后的服务端路径 */
  url?: string
  /** 0-1 上传进度 */
  progress: number
  error?: string
}

/**
 * 图片上传状态机：发帖 / 评论 / 私信三处共用的「选择 → 校验 → 上传 → 重试 → 删除」流程。
 *
 * 选择入口：把模板 file input 绑定到返回的 `fileInput`，点击按钮调 `pickImages`；
 * 粘贴调 `onPaste`；拖拽调 `onDrop`（仅在调用方模板绑定拖拽事件时生效）。
 * `maxCount` 为本次上传的最大张数（超限提示统一文案）。
 */
export function useImageUpload(maxCount: number) {
  const toast = useToast()
  const images = ref<PendingImage[]>([])
  const fileInput = ref<HTMLInputElement | null>(null)

  /** 存在未完成的图片上传时禁止提交 */
  const uploading = computed(() => images.value.some((i) => !i.url && !i.error))
  /** 存在上传失败的图片（提交前需移除或重试） */
  const hasError = computed(() => images.value.some((i) => i.error))

  function addFiles(files: Iterable<File>) {
    for (const file of files) {
      if (images.value.length >= maxCount) {
        toast(`最多上传 ${maxCount} 张图片`)
        break
      }
      if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type)) {
        toast('仅支持 PNG / JPEG / WebP / GIF 图片')
        continue
      }
      if (file.size > IMAGE_MAX_BYTES) {
        toast(`图片「${file.name}」超过 5MB 上限`)
        continue
      }
      const item: PendingImage = { localUrl: URL.createObjectURL(file), file, progress: 0 }
      images.value.push(item)
      // 通过响应式代理引用更新：数组内保存的是 reactive(item)，直接改原始 item 不会触发重渲染
      const img = images.value[images.value.length - 1]
      uploadImage(file, (r) => {
        img.progress = r
      })
        .then((res) => {
          if (res?.url) img.url = res.url
          else img.error = '上传返回异常，请重试'
        })
        .catch((e) => {
          img.error = getErrorMessage(e, '上传失败')
        })
    }
  }

  /** 触发文件选择框（模板需把 ref="fileInput" 绑定到返回的 fileInput） */
  function pickImages() {
    fileInput.value?.click()
  }

  function onFileChange(e: Event) {
    const input = e.target as HTMLInputElement
    if (input.files?.length) addFiles(input.files)
    input.value = '' // 允许重复选择同一文件
  }

  function onPaste(e: ClipboardEvent) {
    const files = e.clipboardData?.files
    if (files?.length) {
      e.preventDefault()
      addFiles(files)
    }
  }

  function onDrop(e: DragEvent) {
    const files = e.dataTransfer?.files
    if (files?.length) addFiles(files)
  }

  function removeImage(idx: number) {
    const [item] = images.value.splice(idx, 1)
    if (item) URL.revokeObjectURL(item.localUrl)
  }

  function retryImage(idx: number) {
    const img = images.value[idx]
    if (!img?.file) return
    img.error = undefined
    img.progress = 0
    uploadImage(img.file, (r) => {
      img.progress = r
    })
      .then((res) => {
        if (res?.url) img.url = res.url
        else img.error = '上传返回异常，请重试'
      })
      .catch((e) => {
        img.error = getErrorMessage(e, '上传失败')
      })
  }

  /** 释放全部本地预览地址并清空（关闭面板 / 发送成功后调用） */
  function reset() {
    for (const i of images.value) URL.revokeObjectURL(i.localUrl)
    images.value = []
  }

  // 组件销毁时必须释放预览 blob URL：调用方可能从未调用 reset（如直接离开页面），
  // 在 composable 内注册清理可覆盖全部调用方；在飞上传的结果只会写入已脱离的 item，无副作用
  onUnmounted(reset)

  return {
    images,
    uploading,
    hasError,
    fileInput,
    addFiles,
    pickImages,
    onFileChange,
    onPaste,
    onDrop,
    removeImage,
    retryImage,
    reset
  }
}
