// 通用小工具

// 取名称首字符作为头像占位
export function nameInitial(name) {
  return (name || '?').trim().charAt(0)
}

// 图片加载失败时隐藏
export function hideOnError(e) {
  e.target.style.display = 'none'
}

// HTML 转义
export function esc(text) {
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// 渲染消息内容：转义后把 *斜体* 转为 <em>
export function renderContent(text) {
  return esc(text).replace(/\*([^*\n]+)\*/g, '<em>$1</em>')
}
