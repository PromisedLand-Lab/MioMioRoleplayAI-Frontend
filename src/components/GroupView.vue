<script setup>
import { computed, nextTick, ref, watch } from 'vue'
import { api } from '../api'
import { askConfirm, toast } from '../store'
import { hideOnError, nameInitial, renderSegments } from '../utils'

const props = defineProps({
  characters: { type: Array, default: () => [] },
})
const emit = defineEmits(['reload'])

// ---- 社群列表 ----
const groups = ref([])
const currentGroup = ref(null)

// ---- 创建弹窗 ----
const createVisible = ref(false)
const createName = ref('')
const createChecked = ref({})

// ---- 群聊 ----
const messages = ref([])
const messageList = ref(null)
const draft = ref('')
const msgKey = ref(1)
const ws = ref(null)
const streaming = ref(false)
const streamRaw = ref('')
const streamSpeaker = ref('')
const autoRounds = ref(2)

const groupTitle = computed(() => {
  if (!currentGroup.value) return '选择一个社群，和多个角色一起聊天'
  const names = currentGroup.value.members.map((m) => m.name).join('、')
  return currentGroup.value.name + '（' + names + '）'
})

watch(messages, () => scrollToBottom(), { deep: true })
function scrollToBottom() {
  nextTick(() => {
    if (messageList.value) messageList.value.scrollTop = messageList.value.scrollHeight
  })
}

async function loadGroups() {
  try {
    groups.value = await api('/api/groups')
  } catch (e) { toast(e.message, true) }
}

async function openGroup(g) {
  resetAll()
  currentGroup.value = g
  try {
    const msgs = await api(`/api/groups/${g.id}/messages`)
    messages.value = msgs.map((m) => ({ ...m, key: 'g' + (msgKey.value++) }))
    connectWS()
  } catch (e) { toast(e.message, true) }
}

function resetAll() {
  currentGroup.value = null
  streaming.value = false
  streamRaw.value = ''
  streamSpeaker.value = ''
  messages.value = []
  closeWS()
}

function closeWS() {
  if (ws.value) { ws.value.onclose = null; ws.value.close(); ws.value = null }
}

function connectWS() {
  closeWS()
  if (!currentGroup.value) return
  const proto = location.protocol === 'https:' ? 'wss' : 'ws'
  const sock = new WebSocket(`${proto}://${location.host}/ws_group?group_id=${currentGroup.value.id}`)
  ws.value = sock
  sock.onmessage = (e) => handleWSMsg(JSON.parse(e.data))
  sock.onclose = () => {
    if (streaming.value) finalizeStream(true, '连接已断开')
  }
}

function charOf(name) {
  if (!name || name === 'user') return null
  if (currentGroup.value) {
    const c = currentGroup.value.members.find((m) => m.name === name)
    if (c) return c
  }
  return { name, id: 0 }
}

function handleWSMsg(msg) {
  switch (msg.type) {
    case 'speaker_start': {
      streaming.value = true
      streamRaw.value = ''
      streamSpeaker.value = msg.speaker
      messages.value.push({
        sender: msg.speaker, content: '', msg_type: '', streaming: true, key: 's' + (msgKey.value++),
      })
      break
    }
    case 'token': {
      if (!streaming.value) break
      streamRaw.value += msg.content
      const last = messages.value[messages.value.length - 1]
      if (last && last.streaming) last.content = streamRaw.value
      break
    }
    case 'speaker_end': {
      const last = messages.value[messages.value.length - 1]
      if (last && last.streaming) {
        last.streaming = false
        last.msg_type = detectGroupType(last.content)
      }
      streamSpeaker.value = ''
      streamRaw.value = ''
      break
    }
    case 'done':
      finalizeStream(false)
      break
    case 'error':
      toast(msg.error || msg.message, true)
      if (streaming.value) finalizeStream(true, msg.error || msg.message)
      break
  }
}

function detectGroupType(content) {
  if (!content.includes('*')) return 'speech'
  const t = content.trim()
  if (t.startsWith('*') && t.endsWith('*') && !t.includes('“')) return 'narration'
  return 'mixed'
}

function finalizeStream(isError, errMsg) {
  streaming.value = false
  streamSpeaker.value = ''
  streamRaw.value = ''
  const last = messages.value[messages.value.length - 1]
  if (last && last.streaming) {
    last.streaming = false
    if (isError) {
      last.content = (last.content || '') + (last.content ? '\n' : '') + `[生成失败：${errMsg}]`
    }
  }
}

// ---- 发送 ----
function sendDraft() {
  const text = draft.value.trim()
  if (!text) return
  draft.value = ''
  sendMessage(text)
}

function sendMessage(text) {
  if (streaming.value) { toast('角色们正在发言，请稍候', true); return }
  if (!currentGroup.value) { toast('请先选择社群', true); return }
  messages.value.push({ sender: 'user', content: text, msg_type: 'speech', key: 'u' + (msgKey.value++) })
  if (!ws.value || ws.value.readyState === WebSocket.CLOSED || ws.value.readyState === WebSocket.CLOSING) {
    connectWS()
  }
  const send = () => {
    ws.value.send(JSON.stringify({ type: 'message', content: text, images: [] }))
  }
  if (ws.value.readyState === WebSocket.OPEN) {
    send()
  } else {
    let tries = 0
    const timer = setInterval(() => {
      tries++
      if (ws.value && ws.value.readyState === WebSocket.OPEN) {
        clearInterval(timer)
        send()
      } else if (tries > 30) {
        clearInterval(timer)
        toast('对话连接失败，请刷新页面重试', true)
      }
    }, 200)
  }
}

// 角色间自由对话
function startAutoChat() {
  if (streaming.value) { toast('角色们正在发言，请稍候', true); return }
  if (!currentGroup.value) { toast('请先选择社群', true); return }
  if (!ws.value || ws.value.readyState !== WebSocket.OPEN) {
    connectWS()
    let tries = 0
    const timer = setInterval(() => {
      tries++
      if (ws.value && ws.value.readyState === WebSocket.OPEN) {
        clearInterval(timer)
        ws.value.send(JSON.stringify({ type: 'auto', rounds: Number(autoRounds.value) || 2 }))
      } else if (tries > 30) {
        clearInterval(timer)
        toast('对话连接失败，请刷新页面重试', true)
      }
    }, 200)
  } else {
    ws.value.send(JSON.stringify({ type: 'auto', rounds: Number(autoRounds.value) || 2 }))
  }
}

function onChatKeydown(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    sendDraft()
  }
}

// ---- 创建 / 删除 ----
const creating = ref(false)
function openCreate() {
  createName.value = ''
  createChecked.value = {}
  createVisible.value = true
}

function toggleChar(id) {
  createChecked.value[id] = !createChecked.value[id]
}

const checkedCount = computed(() => Object.values(createChecked.value).filter(Boolean).length)

async function createGroup() {
  if (creating.value) return // 防止重复提交
  const name = createName.value.trim()
  if (!name) { toast('请输入社群名称', true); return }
  const ids = Object.entries(createChecked.value)
    .filter(([, v]) => v)
    .map(([k]) => Number(k))
  if (ids.length < 2) { toast('请至少选择 2 个角色', true); return }
  creating.value = true
  try {
    const { id } = await api('/api/groups', { method: 'POST', body: { name, character_ids: ids } })
    createVisible.value = false
    emit('reload')
    await loadGroups()
    const g = groups.value.find((x) => x.id === id)
    if (g) openGroup(g)
    toast('社群已创建')
  } catch (e) { toast(e.message, true) }
  finally { creating.value = false }
}

async function deleteGroup() {
  if (!currentGroup.value) return
  if (!(await askConfirm(`确定删除社群「${currentGroup.value.name}」？所有聊天记录将一并清除。`))) return
  try {
    await api(`/api/groups/${currentGroup.value.id}`, { method: 'DELETE' })
    toast('社群已删除')
    resetAll()
    emit('reload')
    await loadGroups()
  } catch (e) { toast(e.message, true) }
}
</script>

<template>
  <section class="view">
    <div class="group-layout">
      <!-- 左侧社群列表 -->
      <aside class="group-list-panel card">
        <div class="group-list-header">
          <h3>角色社群</h3>
          <button class="btn btn-primary btn-sm" @click="openCreate">＋ 新建社群</button>
        </div>
        <ul class="group-list">
          <li v-if="groups.length === 0" class="empty-item">还没有社群，点击上方「新建社群」创建</li>
          <li v-for="g in groups" :key="g.id" :class="{ active: currentGroup && currentGroup.id === g.id }"
              @click="openGroup(g)">
            <div class="group-list-name">{{ g.name }}</div>
            <div class="group-list-members">{{ g.members.map((m) => m.name).join('、') }}</div>
          </li>
        </ul>
      </aside>

      <!-- 群聊主区域 -->
      <div class="chat-main">
        <header class="chat-header">
          <div class="chat-title">{{ groupTitle }}</div>
          <div class="group-auto">
            <label class="auto-rounds">自由对话轮数
              <input type="number" min="1" max="5" v-model.number="autoRounds">
            </label>
            <button class="btn btn-ghost" :disabled="streaming" @click="startAutoChat">让角色们自由对话</button>
          </div>
          <button v-if="currentGroup" class="btn btn-ghost btn-danger-text" @click="deleteGroup">删除社群</button>
        </header>
        <div class="message-list" ref="messageList">
          <div class="empty-tip" v-if="messages.length === 0">
            选择或创建一个社群，你的消息会同时被所有角色看到<br>
            点「让角色们自由对话」可以看角色们自己聊天
          </div>
          <div v-for="m in messages" :key="m.key" class="msg group-msg" :class="{ user: m.sender === 'user' }">
            <div class="group-sender" v-if="m.sender !== 'user'">
              <span class="char-avatar-sm">
                <img v-if="charOf(m.sender) && charOf(m.sender).avatar" :src="charOf(m.sender).avatar" alt="" @error="hideOnError">
                <template v-else>{{ nameInitial(m.sender) }}</template>
              </span>
              <span class="group-sender-name">{{ m.sender }}</span>
              <span v-if="m.streaming" class="group-typing">正在说话…</span>
            </div>
            <div class="bubble" :class="{ narration: m.msg_type === 'narration' }" v-html="renderSegments(m.content)"></div>
          </div>
        </div>
        <form class="chat-input" @submit.prevent="sendDraft">
          <div class="chat-input-row">
            <textarea v-model="draft" rows="3" placeholder="对全体角色说话…（Enter 发送，Shift+Enter 换行）" @keydown="onChatKeydown"></textarea>
            <button type="submit" class="btn btn-primary">发送</button>
          </div>
        </form>
      </div>
    </div>

    <!-- 创建社群弹窗 -->
    <div class="modal" v-if="createVisible">
      <div class="modal-mask" @click="createVisible = false"></div>
      <div class="modal-body group-modal">
        <div class="modal-header">
          <h3>新建角色社群</h3>
          <button class="btn-close" @click="createVisible = false">×</button>
        </div>
        <form class="form" @submit.prevent="createGroup">
          <label>社群名称<input type="text" v-model.trim="createName" placeholder="如：小酒馆的夜晚"></label>
          <div class="group-pick-title">选择成员角色（至少 2 个，当前已选 {{ checkedCount }} 个）</div>
          <div class="group-pick-list">
            <div v-if="characters.length === 0" class="empty-item">还没有角色，请先前往「角色」页创建</div>
            <label v-for="c in characters" :key="c.id" class="group-pick-item" :class="{ picked: createChecked[c.id] }">
              <input type="checkbox" :checked="!!createChecked[c.id]" @change="toggleChar(c.id)">
              <span class="char-avatar-sm">
                <img v-if="c.avatar" :src="c.avatar" alt="" @error="hideOnError">
                <template v-else>{{ nameInitial(c.name) }}</template>
              </span>
              <span>{{ c.name }}</span>
              <small>{{ c.identity || '' }}</small>
            </label>
          </div>
          <div class="form-actions">
            <button type="button" class="btn btn-ghost" @click="createVisible = false">取消</button>
            <button type="submit" class="btn btn-primary" :disabled="creating">{{ creating ? '创建中…' : '创建社群' }}</button>
          </div>
        </form>
      </div>
    </div>
  </section>
</template>
