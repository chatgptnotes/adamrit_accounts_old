import React, { useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { FileUp, Download, AlertTriangle } from "lucide-react";
import { ALL_ROLES } from "@/config/tileAccess";
import type { AdminUser, ImportedCredential, ImportFailure } from "@/hooks/useAdminUsers";
import { HOSPITALS } from "./constants";

const COLUMNS = ["full_name", "email", "phone", "role", "hospital_type", "department"] as const;

/**
 * A real CSV parser rather than text.split(",").
 *
 * The previous implementation split on commas and newlines, so a single quoted
 * field containing a comma ("Nikhare, Shailesh") silently shifted every later
 * column by one, and a Windows CRLF file left a stray \r on the last value of
 * every row. Both produced plausible-looking garbage rather than an error.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];

    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 1; }
        else quoted = false;
      } else field += char;
      continue;
    }

    if (char === '"') { quoted = true; continue; }
    if (char === ",") { row.push(field); field = ""; continue; }
    if (char === "\r") continue;
    if (char === "\n") { row.push(field); rows.push(row); row = []; field = ""; continue; }
    field += char;
  }

  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((cell) => cell.trim() !== ""));
}

interface ParsedRow {
  values: Record<string, string>;
  problem: string | null;
}

interface Props {
  open: boolean;
  existingUsers: AdminUser[];
  importing: boolean;
  onClose: () => void;
  onImport: (rows: Record<string, string>[]) => Promise<{
    users: AdminUser[];
    failures: ImportFailure[];
    credentials: ImportedCredential[];
  }>;
}

const CsvImportDialog: React.FC<Props> = ({ open, existingUsers, importing, onClose, onImport }) => {
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [headerError, setHeaderError] = useState("");
  const [result, setResult] = useState<{ credentials: ImportedCredential[]; failures: ImportFailure[] } | null>(null);

  const knownRoles = useMemo(() => new Set<string>(ALL_ROLES as readonly string[]), []);
  const knownHospitals = useMemo(() => new Set(HOSPITALS.map((h) => h.value)), []);
  const takenEmails = useMemo(
    () => new Set(existingUsers.map((u) => String(u.email || "").toLowerCase())),
    [existingUsers],
  );

  const reset = () => {
    setRows([]);
    setHeaderError("");
    setResult(null);
  };

  const handleFile = async (file?: File) => {
    reset();
    if (!file) return;

    const grid = parseCsv(await file.text());
    if (!grid.length) return setHeaderError("That file has no rows.");

    const headers = grid[0].map((h) => h.trim().toLowerCase());
    const missing = ["full_name", "email"].filter((c) => !headers.includes(c));
    if (missing.length) {
      return setHeaderError(
        `Missing required column${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}. Expected: ${COLUMNS.join(", ")}.`,
      );
    }

    // Every problem is named on its row rather than the row being dropped in
    // silence, so a short import is always explainable.
    const seen = new Set<string>();
    const parsed: ParsedRow[] = grid.slice(1).map((cells) => {
      const values: Record<string, string> = {};
      COLUMNS.forEach((column) => {
        const index = headers.indexOf(column);
        values[column] = index >= 0 ? (cells[index] || "").trim() : "";
      });

      const email = values.email.toLowerCase();
      let problem: string | null = null;
      if (!values.full_name) problem = "Missing full name";
      else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) problem = "Invalid email";
      else if (takenEmails.has(email)) problem = "A user with this email already exists";
      else if (seen.has(email)) problem = "Duplicate email in this file";
      else if (values.role && !knownRoles.has(values.role)) problem = `Unknown role "${values.role}"`;
      else if (values.hospital_type && !knownHospitals.has(values.hospital_type.toLowerCase())) {
        problem = `Unknown hospital "${values.hospital_type}"`;
      }
      if (!problem) seen.add(email);

      return { values, problem };
    });

    setRows(parsed);
  };

  const valid = rows.filter((r) => !r.problem);
  const invalid = rows.length - valid.length;

  const runImport = async () => {
    const outcome = await onImport(valid.map((r) => r.values));
    setResult({ credentials: outcome.credentials, failures: outcome.failures });
    setRows([]);
  };

  const downloadCredentials = () => {
    if (!result?.credentials.length) return;
    const csv = [
      "full_name,email,phone,password",
      ...result.credentials.map((c) =>
        [c.full_name, c.email, c.phone || "", c.password]
          .map((v) => `"${String(v).replace(/"/g, '""')}"`)
          .join(","),
      ),
    ].join("\n");

    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "new-user-credentials.csv";
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) { reset(); onClose(); } }}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileUp className="h-5 w-5" />
            Bulk Upload Users via CSV
          </DialogTitle>
        </DialogHeader>

        {result ? (
          <div className="space-y-4 py-2">
            <p className="text-sm">
              Imported <strong>{result.credentials.length}</strong> user
              {result.credentials.length === 1 ? "" : "s"}
              {result.failures.length > 0 && `, skipped ${result.failures.length}`}.
            </p>

            {result.credentials.length > 0 && (
              <>
                <p className="flex items-start gap-2 text-sm text-red-600">
                  <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                  Each new user has their own password, shown only now. Download
                  this file before closing — it cannot be produced again.
                </p>
                <Button onClick={downloadCredentials}>
                  <Download className="h-4 w-4 mr-1" />
                  Download credentials CSV
                </Button>
                <div className="max-h-64 overflow-y-auto border rounded">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Name</TableHead>
                        <TableHead>Email</TableHead>
                        <TableHead>Password</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {result.credentials.map((c) => (
                        <TableRow key={c.email}>
                          <TableCell>{c.full_name}</TableCell>
                          <TableCell>{c.email}</TableCell>
                          <TableCell className="font-mono text-xs">{c.password}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </>
            )}

            {result.failures.length > 0 && (
              <div className="text-sm space-y-1">
                <p className="font-medium">Skipped:</p>
                {result.failures.map((f, i) => (
                  <p key={i} className="text-muted-foreground">
                    {f.email || "(no email)"} — {f.reason}
                  </p>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-4 py-2">
            <p className="text-sm text-muted-foreground">
              CSV columns:{" "}
              <code className="bg-muted px-1 rounded text-xs">{COLUMNS.join(", ")}</code>.
              Only <code className="bg-muted px-1 rounded text-xs">full_name</code> and{" "}
              <code className="bg-muted px-1 rounded text-xs">email</code> are required.
              Each user gets their own generated password and must change it at first login.
            </p>

            <Input type="file" accept=".csv" onChange={(e) => handleFile(e.target.files?.[0])} />

            {headerError && (
              <p className="text-sm text-red-600 bg-red-50 p-2 rounded">{headerError}</p>
            )}

            {rows.length > 0 && (
              <>
                <p className="text-sm font-medium">
                  {valid.length} of {rows.length} rows will be imported
                  {invalid > 0 && <span className="text-red-600"> · {invalid} skipped</span>}
                </p>
                <div className="max-h-72 overflow-y-auto border rounded">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>#</TableHead>
                        <TableHead>Name</TableHead>
                        <TableHead>Email</TableHead>
                        <TableHead>Role</TableHead>
                        <TableHead>Hospital</TableHead>
                        <TableHead>Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {rows.map((row, idx) => (
                        <TableRow key={idx} className={row.problem ? "bg-red-50" : undefined}>
                          <TableCell>{idx + 1}</TableCell>
                          <TableCell>{row.values.full_name || "-"}</TableCell>
                          <TableCell>{row.values.email || "-"}</TableCell>
                          <TableCell className="capitalize">{row.values.role || "receptionist"}</TableCell>
                          <TableCell className="capitalize">{row.values.hospital_type || "hope"}</TableCell>
                          <TableCell className={row.problem ? "text-red-600 text-xs" : "text-green-700 text-xs"}>
                            {row.problem || "Ready"}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </>
            )}
          </div>
        )}

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => { reset(); onClose(); }}
            disabled={importing}
          >
            {result ? "Close" : "Cancel"}
          </Button>
          {!result && (
            <Button onClick={runImport} disabled={importing || valid.length === 0}>
              {importing ? "Importing..." : `Import ${valid.length} user${valid.length === 1 ? "" : "s"}`}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default CsvImportDialog;
