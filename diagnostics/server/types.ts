export type CheckStatus = "PASS" | "WARN" | "FAIL";

export type NamedCheck = {
  status: CheckStatus;
  message: string;
  details?: Record<string, unknown>;
};

export type DiagnosticPayload = {
  overall: CheckStatus;
  authoritative: true;
  diagnostic_version: string;
  timestamp: string;
  duration_ms: number;
  checks?: Record<string, NamedCheck>;
  error?: string;
};

export type DiagnosticRunResult = {
  statusCode: number;
  payload: DiagnosticPayload;
};

export type ColumnRow = {
  table_name: string;
  column_name: string;
};

export type ForeignKeyRow = {
  constraint_name: string;
  table_name: string;
  column_name: string;
  foreign_table_name: string;
  foreign_column_name: string;
};
