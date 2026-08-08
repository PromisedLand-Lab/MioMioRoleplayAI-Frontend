<script setup>
import { onMounted, ref } from 'vue'
import { api } from './api'
import { toast } from './store'
import Sidebar from './components/Sidebar.vue'
import ChatView from './components/ChatView.vue'
import CharactersView from './components/CharactersView.vue'
import ModelsView from './components/ModelsView.vue'
import ConfirmModal from './components/ConfirmModal.vue'
import Toast from './components/Toast.vue'

const view = ref('chat')
const characters = ref([])
const currentCharacter = ref(null)
const models = ref([])
const defaultModelId = ref('')

async function loadCharacters() {
  try {
    characters.value = await api('/api/characters')
  } catch (e) { toast(e.message, true) }
}

async function loadModels() {
  try {
    models.value = await api('/api/models')
    const def = models.value.find((m) => m.is_default) || models.value[0]
    defaultModelId.value = def ? String(def.id) : ''
  } catch (e) { toast(e.message, true) }
}

function selectCharacter(c) {
  currentCharacter.value = c
  view.value = 'chat'
}

// 删除的角色若是当前对话角色，则清除选中状态（ChatView 会随之重置会话）
function handleCharacterDeleted(c) {
  if (currentCharacter.value && currentCharacter.value.id === c.id) {
    currentCharacter.value = null
  }
}

async function pickDefaultModel(m) {
  defaultModelId.value = String(m.id)
  try {
    await api(`/api/models/${m.id}/default`, { method: 'POST' })
    await loadModels()
    toast('默认模型已切换')
  } catch (err) { toast(err.message, true) }
}

onMounted(async () => {
  await Promise.all([loadCharacters(), loadModels()])
})
</script>

<template>
  <div class="app">
    <Sidebar
      :view="view"
      :characters="characters"
      :current-character="currentCharacter"
      :models="models"
      :default-model-id="defaultModelId"
      @set-view="view = $event"
      @select-character="selectCharacter"
      @pick-default-model="pickDefaultModel"
    />
    <main class="main">
      <ChatView v-show="view === 'chat'" :character="currentCharacter" />
      <CharactersView v-show="view === 'characters'"
                      :characters="characters"
                      @select-character="selectCharacter"
                      @reload="loadCharacters"
                      @deleted="handleCharacterDeleted" />
      <ModelsView v-show="view === 'models'" :models="models" @reload="loadModels" />
    </main>
    <ConfirmModal />
    <Toast />
  </div>
</template>
