<script lang="ts">
  import SingleSelect from '$lib/components/single-select.svelte';
  import type { AgentFormRow, AgentFormField } from '@mspbyte/shared';
  import { AGENT_PSA_SOURCES } from '@mspbyte/shared';
  import { Camera, Upload, Minus, Paperclip } from '@lucide/svelte';

  interface Props {
    rows: AgentFormRow[];
    formName?: string;
    formDescription?: string;
    appName?: string;
    primaryColor?: string;
    logoUrl?: string;
    psaId?: string;
  }

  let {
    rows,
    formName = 'New Form',
    formDescription,
    appName = 'IT Support',
    primaryColor = '#3b82f6',
    logoUrl,
    psaId = '',
  }: Props = $props();

  const hasContent = $derived(rows.length > 0 && rows.some(r => r.cols.length > 0));
</script>

<!--
  Renders a faithful preview of the agent form inside a mock desktop window.
  All inputs are functional so reviewers can feel the form's UX.
-->
<div class="flex flex-col rounded-lg border shadow-lg overflow-hidden bg-background text-foreground w-full max-w-[440px] mx-auto select-none">

  <!-- Title bar -->
  <div class="flex items-center gap-2 px-3 py-2 bg-muted border-b shrink-0">
    <div class="flex gap-1.5 shrink-0">
      <span class="h-2.5 w-2.5 rounded-full bg-red-400/80"></span>
      <span class="h-2.5 w-2.5 rounded-full bg-yellow-400/80"></span>
      <span class="h-2.5 w-2.5 rounded-full bg-green-400/80"></span>
    </div>
    <div class="flex items-center gap-1.5 flex-1 justify-center">
      {#if logoUrl}
        <img src={logoUrl} alt="" class="h-3.5 w-3.5 rounded object-contain" />
      {/if}
      <span class="text-xs font-medium text-muted-foreground">{appName}</span>
    </div>
  </div>

  <!-- Form body -->
  <div class="flex flex-col gap-3 p-4 overflow-y-auto max-h-[480px]">
    {#if formName}
      <div class="flex flex-col gap-0.5 mb-1">
        <p class="text-sm font-semibold">{formName}</p>
        {#if formDescription}
          <p class="text-xs text-muted-foreground">{formDescription}</p>
        {/if}
      </div>
    {/if}

    {#if hasContent}
      {#each rows as row (row.id)}
        {#if row.cols.length > 0}
          <div class="grid gap-2 items-start" style="grid-template-columns: repeat({row.cols_max ?? 3}, 1fr)">
            {#each row.cols as field (field.id)}
              <div style="grid-column: span {field.col_span}">
                {#if field.type === 'spacer'}
                  <!-- intentional blank space -->
                {:else if field.type === 'title'}
                  <div class="pt-1">
                    <p class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{field.label || 'Section'}</p>
                    {#if field.subtitle}
                      <p class="text-xs text-muted-foreground mt-0.5">{field.subtitle}</p>
                    {/if}
                  </div>
                {:else if field.type === 'checkbox'}
                  <label class="flex items-start gap-2 cursor-pointer py-0.5">
                    <input type="checkbox" class="mt-0.5 rounded border-border accent-primary" />
                    <span class="text-xs leading-tight">
                      {field.label || 'Checkbox'}
                      {#if field.required}<span class="text-destructive ml-0.5">*</span>{/if}
                    </span>
                  </label>
                {:else if field.type === 'attachment'}
                  <div class="flex flex-col gap-1">
                    <label class="text-xs font-medium">
                      {field.label || 'Attachment'}
                      {#if field.required}<span class="text-destructive ml-0.5">*</span>{/if}
                    </label>
                    <div class="flex gap-1.5">
                      {#if field.allowUpload ?? true}
                        <button
                          type="button"
                          class="flex flex-1 items-center gap-1.5 text-xs px-2 py-1.5 rounded border border-dashed border-border hover:bg-muted transition-colors text-muted-foreground justify-center"
                        >
                          <Upload class="size-3" />
                          Upload
                        </button>
                      {/if}
                      {#if field.allowScreenshot ?? true}
                        <button
                          type="button"
                          class="flex flex-1 items-center gap-1.5 text-xs px-2 py-1.5 rounded border border-border hover:bg-muted transition-colors justify-center"
                        >
                          <Camera class="size-3" />
                          Screenshot
                        </button>
                      {/if}
                    </div>
                    {#if field.helpText}
                      <p class="text-xs text-muted-foreground">{field.helpText}</p>
                    {/if}
                  </div>
                {:else if field.type === 'select'}
                  <div class="flex flex-col gap-1">
                    <label class="text-xs font-medium">
                      {field.label || 'Dropdown'}
                      {#if field.required}<span class="text-destructive ml-0.5">*</span>{/if}
                    </label>
                    <SingleSelect
                      aria-label={field.label || 'Dropdown'}
                      options={field.psaSource
                        ? [{ value: '__psa_preview', label: `${AGENT_PSA_SOURCES.find(source => source.value === field.psaSource)?.label ?? field.psaSource} from ${psaId || 'PSA'}`, disabled: true }]
                        : field.selectOptions ?? field.options?.map(option => ({ value: option, label: option })) ?? []}
                      placeholder={field.placeholder || 'Select…'}
                      class="h-8 text-xs"
                    />
                    {#if field.helpText}
                      <p class="text-xs text-muted-foreground">{field.helpText}</p>
                    {/if}
                  </div>
                {:else}
                  <!-- text, textarea, email, phone, number -->
                  <div class="flex flex-col gap-1">
                    <label class="text-xs font-medium">
                      {field.label || 'Field'}
                      {#if field.required}<span class="text-destructive ml-0.5">*</span>{/if}
                    </label>
                    {#if field.type === 'textarea'}
                      <textarea
                        placeholder={field.placeholder || ''}
                        rows={3}
                        class="text-xs px-2 py-1.5 rounded border border-border bg-background focus:outline-none focus:ring-1 focus:ring-primary resize-none w-full"
                      ></textarea>
                    {:else}
                      <input
                        type={field.type === 'email' ? 'email' : field.type === 'phone' ? 'tel' : field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : 'text'}
                        placeholder={field.placeholder || ''}
                        class="text-xs px-2 py-1.5 rounded border border-border bg-background focus:outline-none focus:ring-1 focus:ring-primary w-full"
                      />
                    {/if}
                    {#if field.helpText}
                      <p class="text-xs text-muted-foreground">{field.helpText}</p>
                    {/if}
                  </div>
                {/if}
              </div>
            {/each}
          </div>
        {/if}
      {/each}
    {:else}
      <div class="flex flex-col items-center gap-2 py-8 text-center">
        <Minus class="size-4 text-muted-foreground/40" />
        <p class="text-xs text-muted-foreground">Add fields to see a preview</p>
      </div>
    {/if}

    <!-- Submit -->
    {#if hasContent}
      <div class="pt-1">
        <button
          type="button"
          class="w-full py-2 text-xs font-semibold text-white rounded transition-opacity hover:opacity-90"
          style="background-color: {primaryColor}"
        >
          Submit
        </button>
      </div>
    {/if}
  </div>
</div>
