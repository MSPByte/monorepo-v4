export type FieldType = 'text' | 'textarea' | 'select' | 'email' | 'phone' | 'checkbox' | 'number' | 'date' | 'image' | 'attachment';

export type FieldDef = {
  id: string;
  type: FieldType;
  label: string;
  required: boolean;
  col_span: 1 | 2 | 3;
  placeholder?: string;
  options?: string[];
  selectOptions?: { label: string; value: string }[];
  allowUpload?: boolean;
  allowScreenshot?: boolean;
};

export type FormRow = { cols: FieldDef[] };

export type FormDef = {
  id: string;
  name: string;
  description?: string;
  rows: FormRow[];
  // Server-derived: this form's automation uses the submitter's verified
  // identity, so the UI offers an optional Microsoft sign-in before submit.
  wantsEntraIdentity?: boolean;
};

export type Branding = {
  appName?: string;
  primaryColor?: string;
  supportEmail?: string;
  supportPhone?: string;
  logoUrl?: string;
};

export type Bundle = {
  branding: Branding;
  tray?: {
    show?: boolean;
    label?: string;
    showMyTickets?: boolean;
  };
  forms: FormDef[];
  entraAuthEnabled?: boolean;
};
