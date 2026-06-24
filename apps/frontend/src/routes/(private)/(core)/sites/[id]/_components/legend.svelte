<script lang="ts">
  import SourceGlyph from './source-glyph.svelte';
</script>

<div class="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
  <span class="flex items-center gap-1.5">
    <SourceGlyph source="generated" /> generated
  </span>
  <span class="flex items-center gap-1.5">
    <SourceGlyph source="user_options" /> structured
  </span>
  <span class="flex items-center gap-1.5">
    <SourceGlyph source="user_free" /> free-form
  </span>
  <span class="flex items-center gap-1.5">
    <SourceGlyph source="user_flex" /> tribal
  </span>
</div>
