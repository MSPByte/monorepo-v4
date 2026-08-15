import {
  FIELD_TYPES,
  fieldTypeLabel,
  resolvePackageInputFieldType,
  resolvePackageOutputFieldType,
  type FieldTypeId,
} from '@mspbyte/shared';
import type { InputMetaEntry, OutputMetaEntry } from './types.js';

export { FIELD_TYPES as PACKAGE_FIELD_TYPES, type FieldTypeId as PackageFieldTypeId, fieldTypeLabel as packageFieldTypeLabel };
export type PackageFieldType = (typeof FIELD_TYPES)[FieldTypeId];
export const resolveInputFieldType = (meta: Pick<InputMetaEntry, 'valueType' | 'entityType' | 'typeHint'>) => resolvePackageInputFieldType(meta);
export const resolveOutputFieldType = (meta: Pick<OutputMetaEntry, 'valueType' | 'outputType'>) => resolvePackageOutputFieldType(meta);
