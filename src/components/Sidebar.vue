<script setup>
import { computed, ref } from 'vue'
import { nameInitial, hideOnError } from '../utils'

const props = defineProps({
  view: { type: String, default: 'chat' },
  characters: { type: Array, default: () => [] },
  currentCharacter: { type: Object, default: null },
  models: { type: Array, default: () => [] },
  defaultModelId: { type: String, default: '' },
})

const emit = defineEmits(['set-view', 'select-character', 'pick-default-model'])

// 当前模型下拉
const showModelList = ref(false)
const defaultModelLabel = computed(() => {
  const m = props.models.find((x) => String(x.id) === props.defaultModelId)
  return m ? m.name + (m.is_default ? '（默认）' : '') : ''
})

function toggleModelList() { showModelList.value = !showModelList.value }
function hideModelList() { showModelList.value = false }
function pickDefaultModel(m) {
  showModelList.value = false
  emit('pick-default-model', m)
}
</script>

<template>
  <aside class="sidebar">
    <div class="brand"><span class="brand-icon">✿</span> MioMioRoleplayAI</div>
    <nav class="nav">
      <button class="nav-item" :class="{ active: view === 'chat' }" @click="emit('set-view', 'chat')">对话</button>
      <button class="nav-item" :class="{ active: view === 'characters' }" @click="emit('set-view', 'characters')">角色</button>
      <button class="nav-item" :class="{ active: view === 'models' }" @click="emit('set-view', 'models')">模型</button>
    </nav>
    <div class="sidebar-section">
      <div class="sidebar-title">我的角色</div>
      <ul class="character-list">
        <li v-if="characters.length === 0" class="empty-item">暂无角色，请前往「角色」页创建</li>
        <li v-for="c in characters" :key="c.id"
            :class="{ active: currentCharacter && currentCharacter.id === c.id }"
            :title="c.identity || c.name"
            @click="emit('select-character', c)">
          <span class="character-avatar">
            <img v-if="c.avatar" :src="c.avatar" alt="" @error="hideOnError">
            <template v-else>{{ nameInitial(c.name) }}</template>
          </span>
          <span class="character-name">{{ c.name }}</span>
        </li>
      </ul>
    </div>
    <div class="sidebar-footer">
      <div class="model-label">当前模型</div>
      <div class="combo-wrap combo-up">
        <input type="text" readonly class="combo-input dropdown-input" :value="defaultModelLabel"
               :placeholder="models.length ? '选择模型' : '未配置模型，前往「模型」页添加'"
               :disabled="models.length === 0"
               @focus="showModelList = true" @blur="hideModelList">
        <button type="button" class="combo-toggle" :class="{ open: showModelList }"
                @mousedown.prevent="toggleModelList" tabindex="-1">▾</button>
        <ul class="combo-list" v-if="showModelList && models.length">
          <li v-for="m in models" :key="m.id" :class="{ active: String(m.id) === defaultModelId }"
              @mousedown.prevent="pickDefaultModel(m)">{{ m.name }}{{ m.is_default ? '（默认）' : '' }}</li>
        </ul>
      </div>
    </div>
  </aside>
</template>
