<script lang="ts">
  let { name, size = 16 }: { name: string; size?: number } = $props();
</script>

<svg width={size} height={size} aria-hidden="true" focusable="false"><use href={`#i-${name}`} /></svg>
