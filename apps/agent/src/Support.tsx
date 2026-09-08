import { useEffect, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { openUrl } from '@tauri-apps/plugin-opener';
import { toast } from 'sonner';
import type { Bundle, FieldDef, FormDef } from '@/lib/bundle';
import { ipc, type Attachment, type OsUser } from '@/lib/ipc';
import { readFileBase64, chooseImageDialog, takeScreenshot, logToFile } from '@/lib/file';
import { showWindow } from '@/lib/window';
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

  if (field.type === 'image') {
    return (
      <div className="flex flex-col gap-1">
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleChooseImage}
            disabled={disabled}
            className="flex-1 truncate"
          >
            {imageBlob ? imageBlob.name : 'Choose image'}
          </Button>
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
          ) : (
            <Button type="button" variant="outline" size="sm" onClick={handleScreenshot} disabled={disabled}>
              Screenshot
            </Button>
          )}
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

  if (field.type === 'select' && field.options?.length) {
    return (
      <Select value={value} onValueChange={onChange} disabled={disabled}>
        <SelectTrigger>
          <SelectValue placeholder={field.placeholder ?? `Select ${field.label}`} />
        </SelectTrigger>
        <SelectContent>
          {field.options.map((opt) => (
            <SelectItem key={opt} value={opt}>
              {opt}
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
        : 'text'
      }
      placeholder={field.placeholder}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
    />
  );
}

function DynamicForm({
  form,
  osUser,
  onSuccess,
}: {
  form: FormDef;
  osUser: OsUser | null;
  onSuccess: () => void;
}) {
  const [values, setValues] = useState<FieldValues>({});
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
        if (!field.required) continue;
        if (field.type === 'image') {
          if (!images[field.id]) errs[field.id] = `${field.label} is required`;
        } else {
          if (!values[field.id]?.trim()) errs[field.id] = `${field.label} is required`;
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

      const ack = await ipc.submitForm({
        form_id: form.id,
        form_version_id: form.id,
        answers: values,
        os_user: osUser ?? { username: 'unknown', sid: null, display_name: null },
        attachments,
      });

      if (ack.accepted) {
        toast.success('Ticket submitted' + (ack.submission_id ? ` (#${ack.submission_id})` : ''));
        setValues({});
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

  // Load OS user once — not on every bundle refresh
  useEffect(() => {
    ipc.getOsUser().then(setOsUser).catch(() => null);
  }, []);

  // Auto-select when bundle delivers exactly one form
  useEffect(() => {
    if (bundle?.forms?.length === 1) setSelectedForm(bundle.forms[0]);
  }, [bundle]);

  // Open a specific form requested from the tray
  useEffect(() => {
    if (!requestedFormId || !bundle) return;
    setSelectedForm(bundle.forms.find((f) => f.id === requestedFormId) ?? null);
  }, [bundle, requestedFormId]);

  // Reset state when the window is hidden
  useEffect(() => {
    const p = listen('on_hide', () => {
      setSelectedForm(null);
      setSuccess(false);
      if (bundle?.forms?.length === 1) setSelectedForm(bundle.forms[0]);
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
                if (bundle?.forms && bundle.forms.length > 1) setSelectedForm(null);
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
        ) : !selectedForm ? (
          <div className="flex flex-col gap-2">
            <p className="text-sm font-medium">How can we help?</p>
            {bundle!.forms.map((f: FormDef) => (
              <button
                key={f.id}
                onClick={() => setSelectedForm(f)}
                className="text-left border rounded-lg p-3 hover:bg-accent transition-colors"
                style={accentColor ? { borderColor: `${accentColor}80` } : undefined}
              >
                <p className="font-medium text-sm" style={accentColor ? { color: accentColor } : undefined}>{f.name}</p>
                {f.description && (
                  <p className="text-xs text-muted-foreground mt-0.5">{f.description}</p>
                )}
              </button>
            ))}
          </div>
        ) : (
          <>
            {bundle.forms.length > 1 && (
              <button
                onClick={() => setSelectedForm(null)}
                className="text-xs text-muted-foreground hover:text-foreground self-start"
              >
                ← Back
              </button>
            )}
            <p className="font-semibold">{selectedForm.name}</p>
            <DynamicForm
              form={selectedForm}
              osUser={osUser}
              onSuccess={() => setSuccess(true)}
            />
          </>
        )}
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
