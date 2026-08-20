export type FieldType = 'boolean' | 'string' | 'number' | 'date' | 'enum' | 'object';

export type FieldReference = {
  table: string;
  valueColumn: string;
  labelColumn: string;
  specialValues?: { value: string; label: string }[];
};

export type FieldDefinition = {
  type: FieldType;
  label: string;
  modality: 'single' | 'array';
  description?: string;
  options?: { value: string; label: string }[];
  required?: boolean;
  fields?: SchemaFields;
  ingestPath: string;
  trackable: boolean;
  /** Allows a custom report query filter when the field is not stored on the source table. */
  filterable?: boolean;
  reference?: FieldReference;
};

export type SchemaFields = Record<string, FieldDefinition>;

export type SchemaDefinition = {
  label: string;
  fields: SchemaFields;
};
