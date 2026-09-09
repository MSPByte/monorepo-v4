import { useEffect, useState } from 'react';
import { listen, emit } from '@tauri-apps/api/event';
import { openUrl } from '@tauri-apps/plugin-opener';
import { toast } from 'sonner';
import type { Bundle, FieldDef, FormDef } from '@/lib/bundle';
import { ipc, type Attachment, type OsUser } from '@/lib/ipc';
import { readFileBase64, chooseImageDialog, takeScreenshot, logToFile } from '@/lib/file';
import { showWindow } from '@/lib/window';
import type { EntraSsoStatus } from '@/lib/ipc';
import { Input } from '@/ui/components/input';
import { Textarea } from '@/ui/components/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/ui/components/select';
import { Button } from '@/ui/components/button';
import { SubmitButton } from '@/ui/components/submit-button';

type FieldValues = Record<string, string>;
type ImageBlobs = Record<string, { path: string; name: string; b64: string }>;

function colSpanClass(span: 1 | 2 | 3) {
  if (span === 3) return 'col-span-3';
  if (span === 2) return 'col-span-2';
  return 'col-span-1';
}

function FieldInput({
  field,
  value,
  onChange,
  imageBlob,
  onImageChange,
  disabled,
}: {
  field: FieldDef;
  value: string;
  onChange: (v: string) => void;
  imageBlob?: { path: string; name: string; b64: string };
  onImageChange: (blob: { path: string; name: string; b64: string } | null) => void;
  disabled: boolean;
}) {
  const handleChooseImage = async () => {
    const { data: path } = await chooseImageDialog();
    if (!path) return;
    const { data: b64 } = await readFileBase64(path);
    if (!b64) return;
    const name = path.split(/[\\/]/).pop() ?? 'image.png';
    onImageChange({ path, name, b64 });
  };

  const handleScreenshot = async () => {
    const { data: path } = await takeScreenshot();
    await showWindow('support');
    if (!path) return;
    const { data: b64 } = await readFileBase64(path);
    if (!b64) return;
    const name = path.split(/[\\/]/).pop() ?? 'screenshot.png';
    onImageChange({ path, name, b64 });
  };

  if (field.type === 'image' || field.type === 'attachment') {
    const showUpload = field.type === 'image' || field.allowUpload !== false;
    const showScreenshot = field.type === 'image' || field.allowScreenshot !== false;
    const label = showUpload ? (imageBlob ? imageBlob.name : 'Choose file') : (imageBlob ? imageBlob.name : 'Take screenshot');

    return (
      <div className="flex flex-col gap-1">
        <div className="flex gap-2">
          {showUpload && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleChooseImage}
              disabled={disabled}
              className="flex-1 truncate"
            >
              {imageBlob ? imageBlob.name : 'Choose file'}
            </Button>
          )}
          {!showUpload && imageBlob && (
            <span className="flex-1 truncate text-sm py-1">{label}</span>
          )}
          {imageBlob ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => onImageChange(null)}
              disabled={disabled}
            >
              Clear
            </Button>
          ) : showScreenshot ? (
            <Button type="button" variant="outline" size="sm" onClick={handleScreenshot} disabled={disabled}>
              Screenshot
            </Button>
          ) : null}
        </div>
        {imageBlob && (
          <img
            src={`data:image/png;base64,${imageBlob.b64}`}
            alt="preview"
            className="max-h-32 object-contain rounded border"
          />
        )}
      </div>
    );
  }

  if (field.type === 'checkbox') {
    return (
      <label className="flex items-center gap-2 cursor-pointer select-none">
        <input
          type="checkbox"
          checked={value === 'true'}
          onChange={(e) => onChange(e.target.checked ? 'true' : 'false')}
          disabled={disabled}
          className="h-4 w-4 rounded border border-input accent-primary"
        />
        <span className="text-sm text-muted-foreground">{field.placeholder ?? field.label}</span>
      </label>
    );
  }

  if (field.type === 'select' && (field.selectOptions?.length || field.options?.length)) {
    const opts: { label: string; value: string }[] = field.selectOptions?.length
      ? field.selectOptions
      : (field.options ?? []).map((o) => ({ label: o, value: o }));
    return (
      <Select value={value} onValueChange={onChange} disabled={disabled}>
        <SelectTrigger className="w-full">
          <SelectValue placeholder={field.placeholder ?? `Select ${field.label}`} />
        </SelectTrigger>
        <SelectContent>
          {opts.map((opt) => (
            <SelectItem key={opt.value} value={opt.value}>
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }

  if (field.type === 'textarea') {
    return (
      <Textarea
        placeholder={field.placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="resize-none h-20"
      />
    );
  }

  return (
    <Input
      type={
        field.type === 'email' ? 'email'
        : field.type === 'phone' ? 'tel'
        : field.type === 'number' ? 'number'
        : field.type === 'date' ? 'date'
        : 'text'
      }
      placeholder={field.placeholder}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
    />
  );
}

// Shown above automation-linked forms. Sign-in is always optional — skipping
// it means the request is handled by the support team instead of automatically.
function IdentityPrompt({
  sso,
  pending,
  error,
  onSignIn,
}: {
  sso: EntraSsoStatus | null;
  pending: boolean;
  error: string | null;
  onSignIn: () => void;
}) {
  // Only the PKCE cache can supply the token attached to a submission.
  // Device/CLI discovery is useful context, but is not proof available to
  // this process and must not suppress the sign-in action.
  if (sso?.source === 'cached' && sso.user_prt_present && sso.upn) {
    return (
      <p className="text-xs text-muted-foreground">
        Signed in as <span className="font-medium text-foreground">{sso.upn}</span> — this request
        can be completed automatically.
      </p>
    );
  }
  return (
    <div className="rounded-md border bg-muted/40 p-3 flex flex-col gap-2">
      <p className="text-sm">Sign in with Microsoft to have this request completed automatically.</p>
      <div className="flex items-center gap-2">
        <Button type="button" variant="outline" size="sm" onClick={onSignIn} disabled={pending}>
          {pending ? 'Waiting for sign-in…' : 'Sign in with Microsoft'}
        </Button>
        <span className="text-xs text-muted-foreground">
          Or submit without signing in and the support team will handle it.
        </span>
      </div>
      {error && <span className="text-xs text-destructive">{error}</span>}
    </div>
  );
}

function DynamicForm({
  form,
  osUser,
  withIdentity,
  onSuccess,
}: {
  form: FormDef;
  osUser: OsUser | null;
  // When true, attach the cached Microsoft sign-in token (if any) on submit.
  withIdentity: boolean;
  onSuccess: () => void;
}) {
  const defaultValues = (): FieldValues => {
    const defaults: FieldValues = {};
    for (const row of form.rows) {
      for (const field of row.cols) {
        if (field.type === 'select') {
          const first = field.selectOptions?.[0]?.value ?? field.options?.[0];
          if (first !== undefined) defaults[field.id] = first;
        }
      }
    }
    return defaults;
  };

  const [values, setValues] = useState<FieldValues>(defaultValues);
  const [images, setImages] = useState<ImageBlobs>({});
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const setField = (id: string, val: string) =>
    setValues((prev) => ({ ...prev, [id]: val }));
  const setImage = (id: string, blob: { path: string; name: string; b64: string } | null) =>
    setImages((prev) => {
      const next = { ...prev };
      if (blob) next[id] = blob;
      else delete next[id];
      return next;
    });

  const validate = () => {
    const errs: Record<string, string> = {};
    for (const row of form.rows) {
      for (const field of row.cols) {
        if (field.type === 'image' || field.type === 'attachment') {
          if (field.required && !images[field.id]) errs[field.id] = `${field.label} is required`;
        } else if (field.type === 'phone') {
          const digits = (values[field.id] ?? '').replace(/\D/g, '');
          if (field.required && !digits) {
            errs[field.id] = `${field.label} is required`;
          } else if (digits && digits.length !== 10) {
            errs[field.id] = `${field.label} must be a 10-digit phone number`;
          }
        } else {
          if (field.required && !values[field.id]?.trim()) errs[field.id] = `${field.label} is required`;
        }
      }
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;
    setSubmitting(true);
    try {
      const attachments: Attachment[] = Object.entries(images).map(([field_id, blob]) => ({
        field_id,
        name: blob.name,
        mime_type: 'image/png',
        data_b64: blob.b64,
      }));

      // Optional identity: a missing or expired token never blocks submission.
      let entraToken: string | null = null;
      if (withIdentity) {
        entraToken = await ipc.getCachedSsoToken().catch(() => null);
      }

      const ack = await ipc.submitForm({
        form_id: form.id,
        form_version_id: form.id,
        answers: values,
        os_user: osUser ?? { username: 'unknown', sid: null, display_name: null },
        attachments,
        ...(entraToken ? { entra_token: entraToken } : {}),
      });

      if (ack.accepted) {
        const ticketLabel = ack.submission_id ? ` (#${ack.submission_id})` : '';
        if (ack.automation === 'triggered') {
          toast.success(`Request received${ticketLabel} — automation started`);
        } else if (ack.automation === 'skipped' || ack.automation === 'failed_to_trigger') {
          toast.success(`Request received${ticketLabel} — support will handle it`);
        } else {
          toast.success(`Ticket submitted${ticketLabel}`);
        }
        await emit('ticket-submitted');
        setValues(defaultValues);
        setImages({});
        onSuccess();
      } else {
        toast.error(ack.message || 'Submission failed');
      }
    } catch (err) {
      const message = typeof err === 'string' ? err : (err instanceof Error ? err.message : null);
      await logToFile('ERROR', `Form submit error: ${message ?? String(err)}`);
      toast.error(message || 'Failed to submit ticket');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4 flex-1">
      {form.description && (
        <p className="text-sm text-muted-foreground">{form.description}</p>
      )}

      <div className="flex flex-col gap-3 flex-1">
        {form.rows.map((row, rIdx) => (
          <div key={rIdx} className="grid grid-cols-3 gap-3">
            {row.cols.map((field) => (
              <div key={field.id} className={`flex flex-col gap-1 ${colSpanClass(field.col_span)}`}>
                <label className="text-sm font-medium">
                  {field.label}
                  {field.required && <span className="text-destructive ml-0.5">*</span>}
                </label>
                <FieldInput
                  field={field}
                  value={values[field.id] ?? ''}
                  onChange={(v) => setField(field.id, v)}
                  imageBlob={images[field.id]}
                  onImageChange={(b) => setImage(field.id, b)}
                  disabled={submitting}
                />
                {errors[field.id] && (
                  <span className="text-xs text-destructive">{errors[field.id]}</span>
                )}
              </div>
            ))}
          </div>
        ))}
      </div>

      <div className="mt-auto">
        <SubmitButton pending={submitting}>Submit</SubmitButton>
      </div>
    </form>
  );
}

export default function Support({
  bundle,
  requestedFormId,
}: {
  bundle: Bundle | null;
  requestedFormId: string | null;
}) {
  const [osUser, setOsUser] = useState<OsUser | null>(null);
  const [selectedForm, setSelectedForm] = useState<FormDef | null>(null);
  const [success, setSuccess] = useState(false);
  const [sso, setSso] = useState<EntraSsoStatus | null>(null);
  const [authPending, setAuthPending] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  // Load OS user once — not on every bundle refresh
  useEffect(() => {
    ipc.getOsUser().then(setOsUser).catch(() => null);
    ipc.getEntraSsoStatus().then(setSso).catch(() => null);

    const unlistenComplete = listen('entra-auth-complete', () => {
      setAuthPending(false);
      setAuthError(null);
      ipc.getEntraSsoStatus().then(setSso).catch(() => null);
    });
    const unlistenError = listen<string>('entra-auth-error', (event) => {
      setAuthPending(false);
      setAuthError(event.payload ?? 'Sign-in failed');
    });
    return () => {
      unlistenComplete.then((f) => f());
      unlistenError.then((f) => f());
    };
  }, []);

  const handleSignIn = async () => {
    setAuthPending(true);
    setAuthError(null);
    try {
      await ipc.startEntraAuth();
    } catch (e) {
      setAuthPending(false);
      setAuthError(typeof e === 'string' ? e : 'Sign-in failed');
    }
  };

  // Auto-select first form whenever bundle arrives or changes
  useEffect(() => {
    if (bundle?.forms?.length) setSelectedForm(bundle.forms[0]);
  }, [bundle]);

  // Open a specific form requested from the tray
  useEffect(() => {
    if (!requestedFormId || !bundle) return;
    setSelectedForm(bundle.forms.find((f) => f.id === requestedFormId) ?? null);
  }, [bundle, requestedFormId]);

  // Reset state when the window is hidden
  useEffect(() => {
    const p = listen('on_hide', () => {
      setSuccess(false);
      if (bundle?.forms?.length) setSelectedForm(bundle.forms[0]);
    });
    return () => { p.then((u) => u()); };
  }, [bundle]);

  const offline = !bundle;
  const accentColor = bundle?.branding?.primaryColor;
  const companyName = bundle?.branding?.appName ?? 'IT Support';

  return (
    <main className="flex flex-col size-full overflow-hidden">
      {/* Brand header bar */}
      <div
        className="flex items-center px-4 py-2 shrink-0"
        style={{ backgroundColor: accentColor ?? 'hsl(var(--primary))' }}
      >
        {bundle?.branding?.logoUrl && (
          <img src={bundle.branding.logoUrl} alt="" className="size-6 rounded object-contain bg-white/10 mr-2" />
        )}
        <span className="text-white font-semibold text-sm tracking-wide">{companyName}</span>
      </div>

      <div className="flex flex-col flex-1 p-4 gap-3 overflow-y-auto min-h-0">
        {success ? (
          <div className="flex flex-col items-center justify-center flex-1 gap-3">
            <p className="text-lg font-medium">Ticket submitted</p>
            <p className="text-sm text-muted-foreground">Your request has been received.</p>
            <Button
              variant="outline"
              onClick={() => {
                setSuccess(false);
                if (bundle?.forms?.length) setSelectedForm(bundle.forms[0]);
              }}
            >
              Submit another
            </Button>
          </div>
        ) : offline ? (
          <div className="flex flex-col items-center justify-center flex-1 gap-2">
            <p className="font-medium">Agent unavailable</p>
            <p className="text-sm text-muted-foreground">
              The support agent is not running or not yet enrolled.
            </p>
          </div>
        ) : !bundle?.forms?.length ? (
          <div className="flex flex-col items-center justify-center flex-1">
            <p className="text-sm text-muted-foreground">No support forms configured.</p>
          </div>
        ) : selectedForm ? (
          <>
            <p className="font-semibold">{selectedForm.name}</p>
            {selectedForm.wantsEntraIdentity && bundle?.entraAuthEnabled && (
              <IdentityPrompt
                sso={sso}
                pending={authPending}
                error={authError}
                onSignIn={handleSignIn}
              />
            )}
            <DynamicForm
              key={selectedForm.id}
              form={selectedForm}
              osUser={osUser}
              withIdentity={!!selectedForm.wantsEntraIdentity && !!bundle?.entraAuthEnabled}
              onSuccess={() => setSuccess(true)}
            />
          </>
        ) : null}
      </div>
      {(bundle?.branding?.supportEmail || bundle?.branding?.supportPhone) && (
        <footer className="border-t px-4 py-2 text-xs text-muted-foreground flex flex-wrap gap-x-3 gap-y-1 shrink-0">
          {bundle.branding.supportEmail && (
            <button type="button" onClick={() => openUrl(`mailto:${bundle.branding.supportEmail}`)} className="hover:underline">
              {bundle.branding.supportEmail}
            </button>
          )}
          {bundle.branding.supportPhone && (
            <button type="button" onClick={() => openUrl(`tel:${bundle.branding.supportPhone}`)} className="hover:underline">
              {bundle.branding.supportPhone}
            </button>
          )}
        </footer>
      )}
    </main>
  );
}
