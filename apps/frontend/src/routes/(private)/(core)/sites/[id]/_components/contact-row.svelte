<script lang="ts">
  import type { Contact } from '../_profile/client-profile.types';
  import SourceGlyph from './source-glyph.svelte';

  let { contact }: { contact: Contact } = $props();

  const roleLabel: Record<Contact['role'], string> = {
    primary: 'PRIMARY',
    technical: 'TECHNICAL',
    executive: 'EXECUTIVE',
    billing: 'BILLING',
    emergency: 'EMERGENCY',
    third_party_it: '3RD-PARTY IT',
  };
</script>

<div class="grid grid-cols-[88px_minmax(0,1fr)] items-start gap-3 border-b border-border/40 py-1.5 last:border-b-0">
  <div class="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">{roleLabel[contact.role]}</div>
  <div class="min-w-0 space-y-0.5">
    <div class="flex items-center gap-2 text-sm">
      <SourceGlyph source={contact.name.source} />
      <span class="truncate">{contact.name.value}</span>
    </div>
    {#if contact.email || contact.phone}
      <div class="flex flex-wrap gap-x-3 gap-y-0.5 pl-4 font-mono text-[11px] text-muted-foreground">
        {#if contact.email}
          <a href={`mailto:${contact.email.value}`} class="hover:text-foreground">{contact.email.value}</a>
        {/if}
        {#if contact.phone}
          <span>{contact.phone.value}</span>
        {/if}
      </div>
    {/if}
  </div>
</div>
