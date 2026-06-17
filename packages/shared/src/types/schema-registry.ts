export type FieldType = "boolean" | "string" | "number" | "enum" | "object";

export type FieldReference = {
  table: string;
  valueColumn: string;
  labelColumn: string;
  specialValues?: { value: string; label: string }[];
};

export type FieldDefinition = {
  type: FieldType;
  label: string;
  modality: "single" | "array";
  description?: string;
  options?: { value: string; label: string }[];
  required?: boolean;
  fields?: SchemaFields;
  ingestPath: string;
  trackable: boolean;
  reference?: FieldReference;
};

export type SchemaFields = Record<string, FieldDefinition>;

export type SchemaDefinition = {
  label: string;
  fields: SchemaFields;
};
