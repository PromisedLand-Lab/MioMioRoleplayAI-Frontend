<script setup>
import { toastState } from '../store'
</script>

<template>
  <div class="toast" :class="[toastState.isError ? 'error' : '', { hidden: !toastState.msg }]">
    {{ toastState.msg }}
  </div>
</template>
