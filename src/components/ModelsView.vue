<script setup>
import { computed, ref } from 'vue'
import { api } from '../api'
import { PROVIDERS } from '../constants'
import { askConfirm, toast } from '../store'

const props = defineProps({
  models: { type: Array, default: () => [] },
})
const emit = defineEmits(['reload'])

const editingModelId = ref(null)
const modelForm = ref({ name: '', provider: 'ollama', base_url: '', model_name: '', api_key: '', path: '', is_default: false })
const modelCandidates = ref([])
const showModelCandidates = ref(false)
const showProviderList = ref(false)
const testResult = ref('')
const testing = ref(false)

const filteredCandidates = computed(() => {
  const kw = (modelForm.value.model_name || '').trim().toLowerCase()
  if (!kw) return modelCandidates.value
  return modelCandidates.value.filter((n) => n.toLowerCase().includes(kw))
})

const providerLabel = computed(() => {
  const p = PROVIDERS.find((x) => x.value === modelForm.value.provider)
  return p ? p.label : ''
})

function toggleCandidates() { showModelCandidates.value = !showModelCandidates.value }
function hideModelCandidates() { showModelCandidates.value = false }
function pickModel(n) { modelForm.value.model_name = n; showModelCandidates.value = false }

function toggleProviderList() { showProviderList.value = !showProviderList.value }
function hideProviderList() { showProviderList.value = false }
function pickProvider(v) { modelForm.value.provider = v; showProviderList.value = false }

function openModelForm(m = null) {
  editingModelId.value = m ? m.id : null
  if (m) {
    modelForm.value = {
      name: m.name || '', provider: m.provider || 'ollama', base_url: m.base_url || '',
      model_name: m.model_name || '', api_key: m.api_key || '', path: m.path || '',
      is_default: !!m.is_default,
    }
  } else {
    modelForm.value = { name: '', provider: 'ollama', base_url: '', model_name: '', api_key: '', path: '', is_default: false }
  }
  testResult.value = ''
  if (m && m.base_url) testConnection(true)
}

function resetModelForm() { openModelForm(null) }

async function testConnection(silent = false) {
  if (!modelForm.value.base_url) { testResult.value = '请先填写接口地址'; return }
  testing.value = true
  if (!silent) testResult.value = '正在测试连接…'
  try {
    const res = await api('/api/models/test', {
      method: 'POST',
      body: { provider: modelForm.value.provider, base_url: modelForm.value.base_url, api_key: modelForm.value.api_key },
    })
    if (res.ok) {
      modelCandidates.value = res.models || []
      testResult.value = res.message + '，请从列表选择模型'
      if (!silent) toast(res.message)
    } else {
      testResult.value = res.message || '连接失败'
      if (!silent) toast(testResult.value, true)
    }
  } catch (e) {
    testResult.value = e.message
    if (!silent) toast(e.message, true)
  } finally {
    testing.value = false
  }
}

async function saveModel() {
  const body = { ...modelForm.value }
  if (!body.name || !body.base_url || !body.model_name) { toast('名称、接口地址、模型名不能为空', true); return }
  try {
    if (editingModelId.value) {
      await api(`/api/models/${editingModelId.value}`, { method: 'PUT', body })
      toast('模型已更新')
    } else {
      await api('/api/models', { method: 'POST', body })
      toast('模型已添加')
    }
    resetModelForm()
    emit('reload')
  } catch (err) { toast(err.message, true) }
}

async function setDefaultModel(m) {
  try {
    await api(`/api/models/${m.id}/default`, { method: 'POST' })
    emit('reload')
    toast('已设为默认')
  } catch (e) { toast(e.message, true) }
}

async function delModel(m) {
  if (!(await askConfirm(`确定删除模型「${m.name}」？`))) return
  try {
    await api(`/api/models/${m.id}`, { method: 'DELETE' })
    emit('reload')
    toast('模型已删除')
  } catch (e) { toast(e.message, true) }
}
</script>

<template>
  <section class="view">
    <div class="view-header">
      <h2>模型管理</h2>
    </div>
    <div class="model-layout">
      <div class="model-add card">
        <h3>{{ editingModelId ? '编辑模型' : '添加模型' }}</h3>
        <form class="form" @submit.prevent="saveModel">
          <div class="form-row">
            <label>名称<small>自定义显示名</small><input type="text" v-model.trim="modelForm.name" placeholder="如：本地 Ollama"></label>
            <label>供应商
              <div class="combo-wrap">
                <input type="text" readonly class="combo-input dropdown-input" :value="providerLabel"
                       placeholder="选择供应商"
                       @focus="showProviderList = true"
                       @blur="hideProviderList">
                <button type="button" class="combo-toggle" :class="{ open: showProviderList }"
                        @mousedown.prevent="toggleProviderList" tabindex="-1">▾</button>
                <ul class="combo-list" v-if="showProviderList">
                  <li v-for="p in PROVIDERS" :key="p.value"
                      :class="{ active: modelForm.provider === p.value }"
                      @mousedown.prevent="pickProvider(p.value)">{{ p.label }}</li>
                </ul>
              </div>
            </label>
          </div>
          <div class="form-row">
            <label>接口地址<small>如 http://localhost:11434 或 https://api.openai.com/v1</small><input type="text" v-model.trim="modelForm.base_url" placeholder="http://localhost:11434"></label>
            <label>模型名<small>点击「测试连接」后从列表中选择</small>
              <div class="combo-wrap">
                <input type="text" class="combo-input" v-model.trim="modelForm.model_name"
                       placeholder="先测试连接，再从列表选择"
                       @focus="showModelCandidates = true"
                       @input="showModelCandidates = true"
                       @blur="hideModelCandidates">
                <button type="button" class="combo-toggle" :class="{ open: showModelCandidates && filteredCandidates.length }"
                        @mousedown.prevent="toggleCandidates" tabindex="-1">▾</button>
                <ul class="combo-list" v-if="showModelCandidates && filteredCandidates.length">
                  <li v-for="n in filteredCandidates" :key="n" @mousedown.prevent="pickModel(n)">{{ n }}</li>
                </ul>
              </div>
            </label>
          </div>
          <div class="form-row">
            <label>API Key<small>Ollama 可留空</small><input type="password" v-model.trim="modelForm.api_key" placeholder="sk-..."></label>
            <label>接口路径<small>留空按供应商默认（ollama:/api/chat，openai:/v1/chat/completions）</small><input type="text" v-model.trim="modelForm.path" placeholder="留空"></label>
          </div>
          <div class="model-test-bar">
            <button type="button" class="btn btn-ghost" :disabled="testing" @click="testConnection()">{{ testing ? '测试中…' : '测试连接并获取模型列表' }}</button>
            <span class="form-msg">{{ testResult }}</span>
          </div>
          <div class="form-actions">
            <label class="checkbox"><input type="checkbox" v-model="modelForm.is_default"> 设为默认模型</label>
            <div>
              <button type="button" v-if="editingModelId" class="btn btn-ghost" @click="resetModelForm">取消</button>
              <button type="submit" class="btn btn-primary">保存</button>
            </div>
          </div>
        </form>
      </div>
      <div class="model-list-wrap card">
        <h3>已添加模型</h3>
        <ul class="model-list">
          <li v-if="models.length === 0" class="empty-item">尚未添加任何模型，请在左侧表单中添加</li>
          <li v-for="m in models" :key="m.id" class="model-item">
            <div class="model-info">
              <div class="model-name">{{ m.name }}<span v-if="m.is_default" class="badge">默认</span></div>
              <div class="model-meta">{{ m.provider }} · {{ m.model_name }} · {{ m.base_url }}</div>
            </div>
            <button v-if="!m.is_default" class="btn" @click="setDefaultModel(m)">设为默认</button>
            <button class="btn" @click="openModelForm(m)">编辑</button>
            <button class="btn btn-danger" @click="delModel(m)">删除</button>
          </li>
        </ul>
      </div>
    </div>
  </section>
</template>
