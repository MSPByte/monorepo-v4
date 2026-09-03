export type FieldType = 'text' | 'textarea' | 'select' | 'email' | 'phone' | 'checkbox' | 'number' | 'image';

export type FieldDef = {
  id: string;
  type: FieldType;
  label: string;
  required: boolean;
  col_span: 1 | 2 | 3;
  placeholder?: string;
  options?: string[];
};

export type FormRow = { cols: FieldDef[] };

export type FormDef = {
  id: string;
  name: string;
  description?: string;
  rows: FormRow[];
};

export type Branding = {
  companyName: string;
  accentColor: string;
  logoUrl?: string;
};

export type Bundle = {
  branding: Branding;
  tray?: { showTray: boolean };
  forms: FormDef[];
};
