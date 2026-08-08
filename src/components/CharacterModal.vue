<script setup>
import { ref, watch } from 'vue'
import { api } from '../api'
import { CHAR_FIELDS, TEMPLATES } from '../constants'
import { toast } from '../store'

const props = defineProps({
  char: { type: Object, default: null },
})
const emit = defineEmits(['close', 'saved'])

const charForm = ref({})
const tplIndex = ref('')
const charFormMsg = ref('')
const completing = ref(false)

watch(() => props.char, (c) => {
  charForm.value = {}
  if (c) CHAR_FIELDS.forEach((k) => { charForm.value[k] = c[k] || '' })
  tplIndex.value = ''
  charFormMsg.value = ''
}, { immediate: true })

const isEdit = ref(false)
watch(() => props.char, (c) => { isEdit.value = !!c }, { immediate: true })

function applyTemplate() {
  const t = TEMPLATES[Number(tplIndex.value)]
  if (!t) return
  CHAR_FIELDS.forEach((k) => {
    if (!charForm.value[k] && t[k]) charForm.value[k] = t[k]
  })
}

async function autoComplete() {
  const fields = charForm.value
  if (CHAR_FIELDS.every((k) => !(fields[k] || '').trim())) { charFormMsg.value = '请至少填写一项信息后再补全'; return }
  completing.value = true
  charFormMsg.value = '正在调用模型智能补全…'
  try {
    const res = await api('/api/characters/complete', { method: 'POST', body: fields })
    CHAR_FIELDS.forEach((k) => {
      if (!(fields[k] || '').trim() && res[k]) charForm.value[k] = res[k]
    })
    charFormMsg.value = '补全完成，可继续编辑后保存'
  } catch (e) {
    charFormMsg.value = ''
    toast(e.message, true)
  } finally {
    completing.value = false
  }
}

async function saveCharacter() {
  const data = {}
  CHAR_FIELDS.forEach((k) => { data[k] = (charForm.value[k] || '').trim() })
  if (!data.name) { toast('请输入角色名称', true); return }
  try {
    if (props.char) {
      await api(`/api/characters/${props.char.id}`, { method: 'PUT', body: data })
      toast('角色已更新')
    } else {
      await api('/api/characters', { method: 'POST', body: data })
      toast('角色已创建')
    }
    emit('saved')
  } catch (err) { toast(err.message, true) }
}
</script>

<template>
  <div class="modal">
    <div class="modal-mask" @click="emit('close')"></div>
    <div class="modal-body char-modal">
      <div class="modal-header">
        <h3>{{ isEdit ? '编辑角色' : '新建角色' }}</h3>
        <button class="btn-close" @click="emit('close')">×</button>
      </div>
      <div class="modal-toolbar">
        <label>模板
          <select v-model="tplIndex" @change="applyTemplate">
            <option value="">— 选择预设模板 —</option>
            <option v-for="(t, i) in TEMPLATES" :key="i" :value="String(i)">{{ t.name }}</option>
          </select>
        </label>
        <button type="button" class="btn btn-ghost" :disabled="completing" @click="autoComplete">{{ completing ? '正在补全…' : '智能补全（LLM）' }}</button>
      </div>
      <form class="form char-form" @submit.prevent="saveCharacter">
        <div class="form-row">
          <label>名称<input type="text" v-model.trim="charForm.name" placeholder="角色名称"></label>
          <label>头像 URL<input type="text" v-model.trim="charForm.avatar" placeholder="https://...（可选）"></label>
        </div>
        <div class="form-row">
          <label>年龄<input type="text" v-model.trim="charForm.age" placeholder="如 25"></label>
          <label>性别
            <select v-model="charForm.gender">
              <option value="">未设置</option>
              <option value="男">男</option>
              <option value="女">女</option>
              <option value="其他">其他</option>
            </select>
          </label>
        </div>
        <label>身份<input type="text" v-model.trim="charForm.identity" placeholder="如：小镇上的书店老板"></label>
        <label>性格描述<textarea v-model.trim="charForm.personality" rows="3" placeholder="性格特点、说话方式等"></textarea></label>
        <label>语言风格<textarea v-model.trim="charForm.language_style" rows="2" placeholder="如：温柔、文雅、喜欢用比喻"></textarea></label>
        <label>背景故事<textarea v-model.trim="charForm.backstory" rows="3" placeholder="角色的过往经历"></textarea></label>
        <label>行为规则<textarea v-model.trim="charForm.behavior_rules" rows="2" placeholder="角色在对话中应遵守的规则"></textarea></label>
        <label>起始情景<textarea v-model.trim="charForm.opening_scene" rows="3" placeholder="对话开始的场景描述"></textarea></label>
        <div class="form-actions">
          <span class="form-msg">{{ charFormMsg }}</span>
          <button type="submit" class="btn btn-primary">保存角色</button>
        </div>
      </form>
    </div>
  </div>
</template>
