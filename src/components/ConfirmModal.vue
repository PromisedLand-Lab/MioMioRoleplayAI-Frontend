<script setup>
import { confirmState, settleConfirm } from '../store'
</script>

<template>
  <div class="modal" v-if="confirmState.visible">
    <div class="modal-mask" @click="settleConfirm(false)"></div>
    <div class="modal-body confirm-modal">
      <div class="modal-header">
        <h3>确认操作</h3>
        <button class="btn-close" @click="settleConfirm(false)">×</button>
      </div>
      <p class="confirm-text">{{ confirmState.text }}</p>
      <div class="modal-footer">
        <button type="button" class="btn btn-ghost" @click="settleConfirm(false)">取消</button>
        <button type="button" class="btn btn-danger" @click="settleConfirm(true)">确定删除</button>
      </div>
    </div>
  </div>
</template>
