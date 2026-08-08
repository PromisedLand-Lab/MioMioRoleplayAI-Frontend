// REST API 封装：请求走相对路径，开发模式由 Vite 代理转发到 Go 后端
export async function api(url, opts = {}) {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  })
  if (!res.ok) {
    let msg = `请求失败 (${res.status})`
    try { const j = await res.json(); if (j.error) msg = j.error } catch (_) {}
    throw new Error(msg)
  }
  return res.json()
}
