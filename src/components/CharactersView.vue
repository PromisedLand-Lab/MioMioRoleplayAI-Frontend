<script setup>
import { ref } from 'vue'
import { api } from '../api'
import { askConfirm, toast } from '../store'
import { hideOnError, nameInitial } from '../utils'
import CharacterModal from './CharacterModal.vue'

const props = defineProps({
  characters: { type: Array, default: () => [] },
})
const emit = defineEmits(['select-character', 'reload', 'deleted'])

const charModalVisible = ref(false)
const editingCharId = ref(null)

function openCharModal(c = null) {
  editingCharId.value = c ? c.id : null
  charModalVisible.value = true
}
function closeCharModal() { charModalVisible.value = false }

function handleSaved() {
  closeCharModal()
  emit('reload')
}

async function delCharacter(c) {
  if (!(await askConfirm(`确定删除角色「${c.name}」？其所有会话将一并删除。`))) return
  try {
    await api(`/api/characters/${c.id}`, { method: 'DELETE' })
    emit('deleted', c)
    emit('reload')
    toast('角色已删除')
  } catch (err) { toast(err.message, true) }
}
</script>

<template>
  <section class="view">
    <div class="view-header">
      <h2>角色管理</h2>
      <button class="btn btn-primary" @click="openCharModal(null)">新建角色</button>
    </div>
    <div class="character-grid">
      <div class="empty-block" v-if="characters.length === 0">还没有角色，点击右上角「新建角色」创建第一个角色吧</div>
      <div v-for="c in characters" :key="c.id" class="card char-card" @click="emit('select-character', c)">
        <div class="char-card-top">
          <span class="char-avatar-lg">
            <img v-if="c.avatar" :src="c.avatar" alt="" @error="hideOnError">
            <template v-else>{{ nameInitial(c.name) }}</template>
          </span>
          <div>
            <div class="char-card-name">{{ c.name }}</div>
            <div class="char-card-sub">{{ [c.identity, c.gender, c.age].filter(Boolean).join(' · ') || '未完善设定' }}</div>
          </div>
        </div>
        <div class="char-card-desc">{{ c.personality || c.backstory || '暂无描述' }}</div>
        <div class="char-card-actions">
          <button class="btn btn-primary" @click.stop="emit('select-character', c)">对话</button>
          <button class="btn" @click.stop="openCharModal(c)">编辑</button>
          <button class="btn btn-danger" @click.stop="delCharacter(c)">删除</button>
        </div>
      </div>
    </div>

    <CharacterModal v-if="charModalVisible" :char="characters.find((c) => c.id === editingCharId) || null"
                    @close="closeCharModal" @saved="handleSaved" />
  </section>
</template>
