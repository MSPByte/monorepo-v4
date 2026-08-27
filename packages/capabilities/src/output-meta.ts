export type OutputFieldSource = 'response' | 'input';

export interface OutputFieldDef {
  label: string;
  description?: string;
  valueType?: string;
  /** How to resolve this field at execution time. Absent = documentation only. */
  source?: OutputFieldSource;
  /** Dot-notation path into the response body (e.g. "id", "createdDateTime"). */
  path?: string;
  /** Echo an input value directly to outputs (useful for 204 No Content PATCH responses). */
  inputKey?: string;
  sensitive?: boolean;
}
