import { reactive } from 'vue'

// ===== 全局 Toast =====
export const toastState = reactive({
  msg: '',
  isError: false,
  timer: null,
})

export function toast(msg, isError = false) {
  toastState.msg = msg
  toastState.isError = isError
  clearTimeout(toastState.timer)
  toastState.timer = setTimeout(() => { toastState.msg = '' }, 2600)
}

// ===== 全局确认弹窗 =====
export const confirmState = reactive({
  visible: false,
  text: '',
  resolve: null,
})

export function askConfirm(text) {
  confirmState.text = text
  confirmState.visible = true
  return new Promise((resolve) => { confirmState.resolve = resolve })
}

export function settleConfirm(ok) {
  confirmState.visible = false
  if (confirmState.resolve) { confirmState.resolve(ok); confirmState.resolve = null }
}
