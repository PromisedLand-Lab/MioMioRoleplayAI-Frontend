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

// 将消息拆分为段落序列：语言（“引号”）与场景描写（*斜体*）独立成段
// 返回 [{ type: 'speech' | 'narration' | 'text', content }]
export function splitSegments(text) {
  const out = []
  const re = /“([^”]*)”|\*([^*\n]+)\*/g
  let last = 0
  let m
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) {
      const plain = text.slice(last, m.index)
      if (plain.trim()) out.push({ type: 'text', content: plain })
    }
    if (m[1] !== undefined) {
      out.push({ type: 'speech', content: m[1] })
    } else {
      out.push({ type: 'narration', content: m[2] })
    }
    last = re.lastIndex
  }
  if (last < text.length) {
    const plain = text.slice(last)
    if (plain.trim()) out.push({ type: 'text', content: plain })
  }
  return out
}

// 渲染拆分后的消息：语言正常显示、场景描写斜体弱化
export function renderSegments(text) {
  let html = ''
  for (const seg of splitSegments(text)) {
    const cls = seg.type === 'narration' ? 'seg-narration' : seg.type === 'speech' ? 'seg-speech' : 'seg-text'
    html += `<span class="${cls}">${esc(seg.content)}</span>`
  }
  return html
}
