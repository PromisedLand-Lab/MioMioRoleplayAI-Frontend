<script setup>
import { computed, nextTick, ref, watch } from 'vue'
import { api } from '../api'
import { MEM_KIND } from '../constants'
import { askConfirm, toast } from '../store'
import { hideOnError, renderContent } from '../utils'

const props = defineProps({
  character: { type: Object, default: null },
})

// ---- 会话 ----
const sessions = ref([])
const sessionSelectValue = ref('')
const currentSession = ref(null)

// ---- 聊天 ----
const messageList = ref(null)
const messages = ref([])
const draft = ref('')
const msgKey = ref(1)
const ws = ref(null)
const streaming = ref(false)
const pendingImages = ref([])
const streamRaw = ref('')

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
watch([messages, longTermMemories], () => scrollToBottom(), { deep: true })

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
  currentSession.value = Number(id)
  sessionSelectValue.value = String(id)
  streaming.value = false
  streamRaw.value = ''
  closeWS()
  try {
    const msgs = await api(`/api/sessions/${id}/messages`)
    messages.value = msgs.map((m) => ({ ...m, key: 'm' + (msgKey.value++) }))
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
      if (!streaming.value) {
        streaming.value = true
        streamRaw.value = ''
        messages.value.push({ sender: 'assistant', content: '', msg_type: '', streaming: true, key: 's' + (msgKey.value++) })
      }
      streamRaw.value += msg.content
      const last = messages.value[messages.value.length - 1]
      if (last && last.streaming) last.content = streamRaw.value
      break
    }
    case 'done':
      finalizeStream(false)
      break
    case 'error':
      toast(msg.message, true)
      if (streaming.value) finalizeStream(true, msg.message)
      break
  }
}

function finalizeStream(isError, errMsg) {
  streaming.value = false
  const last = messages.value[messages.value.length - 1]
  if (last && last.streaming) {
    last.streaming = false
    if (isError) {
      last.content = (streamRaw.value || '') + (streamRaw.value ? '\n' : '') + `[生成失败：${errMsg}]`
    }
  }
  streamRaw.value = ''
  if (!isError) loadMemories()
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

async function sendMessage(text, images = []) {
  if (streaming.value) { toast('正在生成回复，请稍候', true); return }
  if (!currentSession.value) { toast('请先选择角色', true); return }
  messages.value.push({ sender: 'user', content: text, images, msg_type: 'speech', key: 'u' + (msgKey.value++) })
  // 连接未就绪时等待连接建立后自动补发，避免消息被静默丢弃
  if (!ws.value || ws.value.readyState === WebSocket.CLOSED || ws.value.readyState === WebSocket.CLOSING) {
    connectWS()
  }
  for (let i = 0; i < 30; i++) {
    if (ws.value && ws.value.readyState === WebSocket.OPEN) {
      streaming.value = true
      streamRaw.value = ''
      messages.value.push({ sender: 'assistant', content: '', msg_type: '', streaming: true, key: 's' + (msgKey.value++) })
      ws.value.send(JSON.stringify({ type: 'message', content: text, images }))
      return
    }
    await new Promise((r) => setTimeout(r, 200))
  }
  toast('对话连接失败，请刷新页面重试', true)
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
          <div class="empty-tip" v-if="messages.length === 0">
            <p v-if="character && character.opening_scene">{{ character.opening_scene }}</p>
            {{ character ? '发送第一条消息，开始你们的对话吧' : '选择角色后即可开始沉浸式对话' }}<br>旁白描述将以 <em>斜体</em> 显示
          </div>
          <div v-for="m in messages" :key="m.key" class="msg" :class="[m.sender, { streaming: m.streaming }]">
            <div class="msg-images" v-if="m.images && m.images.length">
              <img v-for="(img, idx) in m.images" :key="idx" :src="img" alt="图片" @error="hideOnError">
            </div>
            <div class="bubble" :class="{ narration: m.msg_type === 'narration' }" v-html="renderContent(m.content)"></div>
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
