<script setup>
import { computed, nextTick, ref, watch } from 'vue'
import { api } from '../api'
import { MEM_KIND } from '../constants'
import { askConfirm, toast } from '../store'
import { hideOnError, renderSegments } from '../utils'

const props = defineProps({
  character: { type: Object, default: null },
})

// ---- 会话 ----
const sessions = ref([])
const sessionSelectValue = ref('')
const currentSession = ref(null)

// ---- 聊天 ----
const messageList = ref(null)
const messages = ref([])      // 全量消息树（含 parent_id）
const activePath = ref([])    // 当前活跃分支的节点 id 序列（根 → 叶子）
const draft = ref('')
const msgKey = ref(1)
const ws = ref(null)
const streaming = ref(false)
const pendingImages = ref([])
const streamRaw = ref('')
const localSeq = ref(0)       // 本地临时节点负 id 生成器（流式结束后全量刷新对齐）

// ---- 分支交互 ----
const editingKey = ref(null)  // 行内编辑中的消息 key
const editText = ref('')
const showActionsKey = ref(null) // 移动端长按后显示操作按钮的消息 key
const isTouch = 'ontouchstart' in window

// 活跃路径上的消息（根 → 叶子，按路径顺序渲染）
const displayMessages = computed(() => {
  const byId = new Map(messages.value.map((m) => [m.id, m]))
  return activePath.value.map((id) => byId.get(id)).filter(Boolean)
})

// ---- 记忆 ----
const memoryCollapsed = ref(false)
const memoryDraft = ref('')
const memorySummary = ref('')
const longTermMemories = ref([])
const shortTermMemories = ref([])

const chatTitle = computed(() => {
  if (!props.character) return '请选择左侧一个角色开始对话'
  return props.character.name + (props.character.identity ? ' · ' + props.character.identity : '')
})

const assistantName = computed(() => (props.character ? props.character.name : '角色'))

// ---- 消息列表滚动 ----
watch([messages, activePath, longTermMemories], () => scrollToBottom(), { deep: true })

function scrollToBottom() {
  nextTick(() => {
    if (messageList.value) messageList.value.scrollTop = messageList.value.scrollHeight
  })
}

// ---- 角色切换：加载会话并连接 WS ----
watch(() => props.character, async (c) => {
  resetAll()
  if (!c) return
  try {
    sessions.value = await api(`/api/characters/${c.id}/sessions`)
    if (sessions.value.length === 0) {
      const { id } = await api('/api/sessions', { method: 'POST', body: { character_id: c.id } })
      sessions.value = await api(`/api/characters/${c.id}/sessions`)
      await switchSession(id)
    } else {
      await switchSession(sessions.value[0].id)
    }
  } catch (err) { toast(err.message, true) }
}, { immediate: true })

function resetAll() {
  currentSession.value = null
  sessionSelectValue.value = ''
  streaming.value = false
  streamRaw.value = ''
  messages.value = []
  activePath.value = []
  editingKey.value = null
  editText.value = ''
  showActionsKey.value = null
  memorySummary.value = ''
  longTermMemories.value = []
  shortTermMemories.value = []
  closeWS()
}

function closeWS() {
  if (ws.value) { ws.value.onclose = null; ws.value.close(); ws.value = null }
}

function onSessionChange(e) {
  if (e.target.value) switchSession(e.target.value)
}

async function switchSession(id) {
  cancelEdit()
  currentSession.value = Number(id)
  sessionSelectValue.value = String(id)
  streaming.value = false
  streamRaw.value = ''
  closeWS()
  try {
    const data = await api(`/api/sessions/${id}/messages`)
    messages.value = (data.messages || []).map((m) => ({ ...m, key: 'm' + (msgKey.value++) }))
    activePath.value = data.active_path || []
    connectWS()
    loadMemories()
  } catch (e) { toast(e.message, true) }
}

async function newSession() {
  if (!props.character) { toast('请先选择角色', true); return }
  try {
    const { id } = await api('/api/sessions', { method: 'POST', body: { character_id: props.character.id } })
    sessions.value = await api(`/api/characters/${props.character.id}/sessions`)
    await switchSession(id)
    toast('已新建会话')
  } catch (e) { toast(e.message, true) }
}

async function deleteSession() {
  if (!currentSession.value) { toast('当前没有可删除的会话', true); return }
  if (!(await askConfirm('确定删除当前会话？对话记录与相关记忆将一并清除，且不可恢复。'))) return
  try {
    await api(`/api/sessions/${currentSession.value}`, { method: 'DELETE' })
    toast('会话已删除')
    sessions.value = sessions.value.filter((s) => String(s.id) !== String(currentSession.value))
    currentSession.value = null
    streaming.value = false
    streamRaw.value = ''
    closeWS()
    if (sessions.value.length > 0) {
      await switchSession(sessions.value[0].id)
    } else {
      sessionSelectValue.value = ''
      messages.value = []
      activePath.value = []
      editingKey.value = null
      editText.value = ''
      memorySummary.value = ''
      longTermMemories.value = []
      shortTermMemories.value = []
    }
  } catch (e) { toast(e.message, true) }
}

// ---- WebSocket ----
function connectWS() {
  closeWS()
  if (!currentSession.value) return
  const proto = location.protocol === 'https:' ? 'wss' : 'ws'
  const sock = new WebSocket(`${proto}://${location.host}/ws?session_id=${currentSession.value}`)
  ws.value = sock
  sock.onmessage = (e) => handleWSMsg(JSON.parse(e.data))
  sock.onclose = () => {
    if (streaming.value) finalizeStream(true, '连接已断开')
  }
}

function handleWSMsg(msg) {
  switch (msg.type) {
    case 'token': {
      // 流式 token 直接追加到当前 streaming 的 assistant 节点
      const st = messages.value.find((m) => m.streaming)
      if (st) st.content += msg.content
      break
    }
    case 'msg_saved':
      // 新消息已入库（流式结束后由服务端统一回传）；done 后全量刷新对齐真实 id
      break
    case 'done':
      finalizeStream(false)
      break
    case 'error':
      toast(msg.message, true)
      finalizeStream(true, msg.message)
      break
  }
}

async function finalizeStream(isError, errMsg) {
  streaming.value = false
  const st = messages.value.find((m) => m.streaming)
  if (st) {
    st.streaming = false
    if (isError) {
      st.content = (st.content || '') + (st.content ? '\n' : '') + `[生成失败：${errMsg}]`
    }
  }
  streamRaw.value = ''
  // 全量刷新：与服务端真实状态（真实消息 id、active_path、state/summary）对齐
  try {
    await reloadMessages()
    loadMemories()
  } catch (e) { /* 刷新失败不影响下一次操作 */ }
}

// ---- 发送 ----
function sendDraft() {
  const text = draft.value.trim()
  if (!text && pendingImages.value.length === 0) return
  const images = pendingImages.value.map((p) => p.dataUrl)
  draft.value = ''
  pendingImages.value = []
  sendMessage(text, images)
}

function onPickImages(e) {
  const files = Array.from(e.target.files || [])
  e.target.value = ''
  const MAX = 4, MAXSIZE = 4 * 1024 * 1024 // 最多 4 张、单张 ≤4MB
  for (const f of files) {
    if (pendingImages.value.length >= MAX) { toast(`最多同时发送 ${MAX} 张图片`, true); break }
    if (f.size > MAXSIZE) { toast(`图片「${f.name}」超过 4MB，已跳过`, true); continue }
    if (!f.type.startsWith('image/')) continue
    const reader = new FileReader()
    reader.onload = () => pendingImages.value.push({ dataUrl: reader.result })
    reader.readAsDataURL(f)
  }
}

function removePendingImage(i) { pendingImages.value.splice(i, 1) }

function onChatKeydown(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    sendDraft()
  }
}

// 发送/编辑消息。parentID 缺省=普通发送（挂当前活跃叶子）；编辑时传入编辑链根的父 + 编辑链组 id
async function sendMessage(text, images = [], parentID = null, editGroup = 0) {
  cancelEdit()
  if (streaming.value) { toast('正在生成回复，请稍候', true); return }
  if (!currentSession.value) { toast('请先选择角色', true); return }
  const pid = parentID !== null && parentID !== undefined
    ? parentID
    : (activePath.value.length ? activePath.value[activePath.value.length - 1] : 0)
  // 本地模拟：树中新增 user + assistant 临时节点，并接管活跃路径（流式结束后全量刷新对齐）
  const userTmpId = --localSeq.value
  const asstTmpId = --localSeq.value
  const userKey = 'm' + (msgKey.value++)
  const asstKey = 'm' + (msgKey.value++)
  messages.value.push({ id: userTmpId, parent_id: pid, edit_group: editGroup, sender: 'user', content: text, images, msg_type: 'speech', key: userKey })
  messages.value.push({ id: asstTmpId, parent_id: userTmpId, sender: 'assistant', content: '', images: [], msg_type: '', streaming: true, key: asstKey })
  const idx = activePath.value.findIndex((id) => id === pid)
  activePath.value = [...(idx >= 0 ? activePath.value.slice(0, idx + 1) : []), userTmpId, asstTmpId]
  // 连接未就绪时等待连接建立后自动补发，避免消息被静默丢弃
  if (!ws.value || ws.value.readyState === WebSocket.CLOSED || ws.value.readyState === WebSocket.CLOSING) {
    connectWS()
  }
  for (let i = 0; i < 30; i++) {
    if (ws.value && ws.value.readyState === WebSocket.OPEN) {
      streaming.value = true
      streamRaw.value = ''
      ws.value.send(JSON.stringify({ type: 'message', parent_id: pid, edit_group: editGroup, content: text, images }))
      return
    }
    await new Promise((r) => setTimeout(r, 200))
  }
  // 连接失败：移除本地模拟的临时节点，提示重试
  messages.value = messages.value.filter((m) => m.key !== userKey && m.key !== asstKey)
  activePath.value = activePath.value.filter((id) => id !== userTmpId && id !== asstTmpId)
  toast('对话连接失败，请刷新页面重试', true)
}

// ---- 分支 ----
// 重新加载消息树与活跃路径（与服务端状态对齐）
async function reloadMessages() {
  if (!currentSession.value) return
  const data = await api(`/api/sessions/${currentSession.value}/messages`)
  messages.value = (data.messages || []).map((m) => ({ ...m, key: 'm' + (msgKey.value++) }))
  activePath.value = data.active_path || []
}

// 切换活跃分支：以目标消息为叶子重建路径
async function activateMessage(messageId) {
  try {
    await api(`/api/sessions/${currentSession.value}/activate`, { method: 'POST', body: { message_id: messageId } })
    await reloadMessages()
    loadMemories() // 摘要/状态随分支联动
  } catch (e) { toast(e.message, true) }
}

// 回复分支信息：只有 user 消息且其下拥有 ≥2 个子消息（assistant 回复 / 重新生成版）才显示，
// 切换该消息下的回复版本；assistant 消息不允许作为分支点
function branchInfo(m) {
  if (m.sender !== 'user') return null
  const children = messages.value.filter((c) => c.parent_id === m.id)
  if (children.length < 2) return null
  const pathIdx = activePath.value.indexOf(m.id)
  const activeChild = pathIdx >= 0 ? activePath.value[pathIdx + 1] : null
  let cur = children.findIndex((c) => c.id === activeChild)
  if (cur < 0) cur = 0
  return { count: children.length, current: cur + 1, children }
}

// 编辑链版本信息：同一 edit_group 的版本数 ≥2 时在 user 消息上显示「版本切换」（找回旧编辑版本）
function versionInfo(m) {
  if (m.sender !== 'user' || !m.edit_group) return null
  const versions = messages.value.filter((x) => x.edit_group === m.edit_group)
  if (versions.length < 2) return null
  let cur = versions.findIndex((v) => v.id === m.id)
  if (cur < 0) cur = 0
  return { count: versions.length, current: cur + 1, versions }
}

// 切换回复分支指示器：dir = -1 上一个 / 1 下一个。不允许循环切换：首项不可向上、尾项不可向下
function switchBranch(m, dir) {
  cancelEdit()
  if (streaming.value) { toast('正在生成回复，请稍候', true); return }
  const info = branchInfo(m)
  if (!info) return
  if ((dir < 0 && info.current <= 1) || (dir > 0 && info.current >= info.count)) return
  const next = info.current - 1 + dir
  // 激活目标分支时下钻到该分支的最深叶子：否则 RebuildActivePath 只重建到顶层子消息，
  // 该分支后续（如 assistant 回复）会被遗漏不渲染
  activateMessage(deepestLeafOf(info.children[next]).id)
}

// 切换编辑链版本：dir = -1 上一个 / 1 下一个。不允许循环切换；激活目标版本分支的最深叶子
function switchVersion(m, dir) {
  cancelEdit()
  if (streaming.value) { toast('正在生成回复，请稍候', true); return }
  const info = versionInfo(m)
  if (!info) return
  if ((dir < 0 && info.current <= 1) || (dir > 0 && info.current >= info.count)) return
  const next = info.current - 1 + dir
  activateMessage(deepestLeafOf(info.versions[next]).id)
}

// 沿子树下钻到某分支的最深后代节点（优先沿当前活跃路径；无子节点则为自身）
function deepestLeafOf(node) {
  let cur = node
  while (true) {
    const children = messages.value.filter((c) => c.parent_id === cur.id)
    if (children.length === 0) return cur
    const pathIdx = activePath.value.indexOf(cur.id)
    let next = null
    if (pathIdx >= 0) {
      next = children.find((c) => c.id === activePath.value[pathIdx + 1]) || null
    }
    cur = next || children[0]
  }
}

// ---- 编辑（user 消息：气泡按钮 / 移动端长按） ----
function startEdit(m) {
  cancelEdit()
  editingKey.value = m.key
  editText.value = m.content
}

function cancelEdit() {
  editingKey.value = null
  editText.value = ''
}

// 编辑链信息：编辑版应挂到「编辑链根的父」下（组内版本并列、互不为祖先 → 活跃路径互斥，
// 该轮只显示一个版本），并携带编辑链组 id（沿用被编辑消息的组；非编辑版以自身为新组根）
function editGroupInfo(m) {
  if (m.edit_group) {
    const root = messages.value.find((x) => x.id === m.edit_group)
    return { group: m.edit_group, parentId: root ? root.parent_id : m.parent_id }
  }
  return { group: m.id, parentId: m.parent_id }
}

function submitEdit(m) {
  const text = editText.value.trim()
  if (!text) { toast('消息内容不能为空', true); return }
  cancelEdit()
  const info = editGroupInfo(m)
  // 编辑版挂到编辑链根的父下（并列），该轮只显示最新版；旧版本经「版本切换」找回
  sendMessage(text, m.images || [], info.parentId, info.group)
}

// ---- 重新生成（assistant 消息） ----
async function regenerate(m) {
  cancelEdit()
  if (streaming.value) { toast('正在生成回复，请稍候', true); return }
  if (!currentSession.value) { toast('请先选择角色', true); return }
  // 本地模拟：同父节点下新增 assistant 版本并接管活跃路径（流式结束后全量刷新对齐）
  const asstTmpId = --localSeq.value
  const asstKey = 'm' + (msgKey.value++)
  messages.value.push({ id: asstTmpId, parent_id: m.parent_id, sender: 'assistant', content: '', images: [], msg_type: '', streaming: true, key: asstKey })
  const idx = activePath.value.findIndex((id) => id === m.parent_id)
  activePath.value = [...(idx >= 0 ? activePath.value.slice(0, idx + 1) : []), asstTmpId]
  if (!ws.value || ws.value.readyState === WebSocket.CLOSED || ws.value.readyState === WebSocket.CLOSING) {
    connectWS()
  }
  for (let i = 0; i < 30; i++) {
    if (ws.value && ws.value.readyState === WebSocket.OPEN) {
      streaming.value = true
      streamRaw.value = ''
      ws.value.send(JSON.stringify({ type: 'regenerate', message_id: m.id }))
      return
    }
    await new Promise((r) => setTimeout(r, 200))
  }
  messages.value = messages.value.filter((mm) => mm.key !== asstKey)
  activePath.value = activePath.value.filter((id) => id !== asstTmpId)
  toast('对话连接失败，请刷新页面重试', true)
}

// ---- 移动端长按：显示/隐藏消息操作按钮 ----
let touchTimer = null
function onTouchStart(m) {
  if (!isTouch) return
  touchTimer = setTimeout(() => {
    showActionsKey.value = showActionsKey.value === m.key ? null : m.key
  }, 500)
}
function onTouchEnd() {
  if (touchTimer) { clearTimeout(touchTimer); touchTimer = null }
}

// ---- 记忆 ----
async function loadMemories() {
  const id = currentSession.value
  if (!id) return
  try {
    const data = await api(`/api/sessions/${id}/memories`)
    memorySummary.value = data.summary || ''
    longTermMemories.value = data.long_term || []
    shortTermMemories.value = (data.short_term || []).slice().reverse()
  } catch (e) { /* 记忆加载失败不影响对话 */ }
}

async function addMemory() {
  const content = memoryDraft.value.trim()
  if (!content) { toast('请输入记忆内容', true); return }
  if (!currentSession.value) { toast('请先选择角色开始会话', true); return }
  try {
    await api(`/api/sessions/${currentSession.value}/memories`, { method: 'POST', body: { content } })
    memoryDraft.value = ''
    await loadMemories()
    toast('记忆已添加')
  } catch (e) { toast(e.message, true) }
}

async function delMemory(m) {
  const id = currentSession.value
  if (!(await askConfirm(`确定删除这条${MEM_KIND[m.kind] || ''}记忆？`))) return
  try {
    await api(`/api/sessions/${id}/memories/${m.kind}/${m.id}`, { method: 'DELETE' })
    await loadMemories()
    toast('记忆已删除')
  } catch (e) { toast(e.message, true) }
}

function memKindName(kind) { return MEM_KIND[kind] || kind }
</script>

<template>
  <section class="view">
    <div class="chat-layout">
      <div class="chat-main">
        <header class="chat-header">
          <div class="chat-title">{{ chatTitle }}</div>
          <select class="session-select" v-model="sessionSelectValue" @change="onSessionChange">
            <option v-for="s in sessions" :key="s.id" :value="String(s.id)">{{ s.title || '会话 #' + s.id }}</option>
          </select>
          <button class="btn btn-ghost" @click="newSession">新建会话</button>
          <button class="btn btn-ghost btn-danger-text" @click="deleteSession">删除会话</button>
        </header>
        <div class="message-list" ref="messageList">
          <div class="empty-tip" v-if="activePath.length === 0">
            <p v-if="character && character.opening_scene">{{ character.opening_scene }}</p>
            {{ character ? '发送第一条消息，开始你们的对话吧' : '选择角色后即可开始沉浸式对话' }}<br>旁白描述将以 <em>斜体</em> 显示
          </div>
          <div v-for="m in displayMessages" :key="m.key" class="msg-row" :class="m.sender">
            <div class="msg" :class="[m.sender, { streaming: m.streaming }]"
                 @touchstart.passive="onTouchStart(m)" @touchend="onTouchEnd" @touchmove.passive="onTouchEnd">
              <div class="msg-images" v-if="m.images && m.images.length">
                <img v-for="(img, idx) in m.images" :key="idx" :src="img" alt="图片" @error="hideOnError">
              </div>
              <div v-if="editingKey === m.key" class="edit-box">
                <textarea v-model="editText" rows="3" placeholder="修改消息…"></textarea>
                <div class="edit-actions">
                  <button class="btn btn-sm" @click="cancelEdit">取消</button>
                  <button class="btn btn-primary btn-sm" @click="submitEdit(m)">保存</button>
                </div>
              </div>
              <div v-else class="bubble" :class="{ narration: m.msg_type === 'narration' }" v-html="renderSegments(m.content)"></div>
              <div v-if="editingKey !== m.key" class="msg-actions" :class="{ visible: showActionsKey === m.key }" @click.stop>
                <button v-if="m.sender === 'user'" class="msg-action-btn" @click="startEdit(m)">编辑</button>
                <button v-else-if="m.sender === 'assistant'" class="msg-action-btn" @click="regenerate(m)">重新生成</button>
              </div>
            </div>
            <div class="branch-bar branch-bar-ver" v-if="editingKey !== m.key && versionInfo(m)">
              <button class="branch-btn" :disabled="streaming || versionInfo(m).current <= 1" @click="switchVersion(m, -1)" title="上一版本">‹</button>
              <span class="branch-count">{{ versionInfo(m).current }}/{{ versionInfo(m).count }}</span>
              <button class="branch-btn" :disabled="streaming || versionInfo(m).current >= versionInfo(m).count" @click="switchVersion(m, 1)" title="下一版本">›</button>
            </div>
            <div class="branch-bar" v-if="editingKey !== m.key && branchInfo(m)">
              <button class="branch-btn" :disabled="streaming || branchInfo(m).current <= 1" @click="switchBranch(m, -1)" title="上一分支">‹</button>
              <span class="branch-count">{{ branchInfo(m).current }}/{{ branchInfo(m).count }}</span>
              <button class="branch-btn" :disabled="streaming || branchInfo(m).current >= branchInfo(m).count" @click="switchBranch(m, 1)" title="下一分支">›</button>
            </div>
          </div>
        </div>
        <form class="chat-input" @submit.prevent="sendDraft">
          <div class="pending-images" v-if="pendingImages.length">
            <div v-for="(img, i) in pendingImages" :key="i" class="pending-img">
              <img :src="img.dataUrl" alt="待发送">
              <button type="button" class="pending-img-del" @click="removePendingImage(i)">×</button>
            </div>
          </div>
          <div class="chat-input-row">
            <textarea v-model="draft" rows="3" placeholder="输入消息…（Enter 发送，Shift+Enter 换行）" @keydown="onChatKeydown"></textarea>
            <div class="chat-input-actions">
              <button type="button" class="img-btn" title="上传图片（最多 4 张，单张 ≤4MB）" @click="$refs.imageInput.click()">🖼</button>
              <button type="submit" class="btn btn-primary">发送</button>
            </div>
          </div>
          <input type="file" ref="imageInput" accept="image/*" multiple hidden @change="onPickImages">
        </form>
      </div>
      <aside class="memory-panel" :class="{ collapsed: memoryCollapsed }">
        <div class="memory-header">
          <h3>记忆库</h3>
          <button class="btn btn-ghost" @click="memoryCollapsed = !memoryCollapsed">{{ memoryCollapsed ? '展开' : '收起' }}</button>
        </div>
        <div class="memory-add">
          <textarea v-model="memoryDraft" rows="2" placeholder="添加一条长期记忆…"></textarea>
          <button class="btn btn-primary" @click="addMemory">添加</button>
        </div>
        <div class="memory-summary" v-if="memorySummary">📌 对话摘要：{{ memorySummary }}</div>
        <div class="memory-section-title">长期记忆（自动识别 + 手动添加）</div>
        <div class="memory-list">
          <div class="memory-empty" v-if="longTermMemories.length === 0">暂无长期记忆，可在上方手动添加</div>
          <div v-for="m in longTermMemories" :key="m.kind + '-' + m.id" class="memory-item">
            <div>{{ m.content }}</div>
            <div class="mem-meta">
              <span><span class="mem-badge">{{ memKindName(m.kind) }}</span><span class="mem-hit">命中 {{ m.hit_count }} 次</span></span>
              <button class="mem-del" @click="delMemory(m)">删除</button>
            </div>
          </div>
        </div>
        <div class="memory-section-title">短期记忆（最近对话）</div>
        <div class="memory-short">
          <div class="memory-empty" v-if="shortTermMemories.length === 0">暂无对话记录</div>
          <div v-for="(m, i) in shortTermMemories" :key="i" class="memory-msg">
            <span class="m-sender" :class="m.sender">{{ m.sender === 'user' ? '你' : assistantName }}</span>{{ m.content }}
          </div>
        </div>
      </aside>
    </div>
  </section>
</template>
