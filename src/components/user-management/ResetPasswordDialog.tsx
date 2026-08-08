import React, { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Copy, Check, MessageCircle, KeyRound, AlertTriangle } from "lucide-react";
import { toWhatsAppNumber, openWhatsApp } from "@/lib/patient-whatsapp";
import type { AdminUser } from "@/hooks/useAdminUsers";

interface Props {
  user: AdminUser | null;
  onClose: () => void;
  onReset: (options: { password?: string; mustChange: boolean }) => Promise<string>;
}

/**
 * Two phases. Phase 1 chooses the password; phase 2 shows it once.
 *
 * The plaintext lives in this component's state and nowhere else — it is not
 * written to the users query cache, and the server does not keep it either. Once
 * this dialog closes the only copy is whatever the admin copied or sent.
 */
const ResetPasswordDialog: React.FC<Props> = ({ user, onClose, onReset }) => {
  const [mode, setMode] = useState<"generate" | "specify">("generate");
  const [typed, setTyped] = useState("");
  const [mustChange, setMustChange] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [issued, setIssued] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (user) {
      setMode("generate");
      setTyped("");
      setMustChange(true);
      setError("");
      setIssued(null);
      setCopied(false);
    }
  }, [user]);

  if (!user) return null;

  const name = user.full_name || user.email;
  const whatsAppNumber = toWhatsAppNumber(user.phone);

  const submit = async () => {
    if (mode === "specify" && typed.trim().length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const password = await onReset({
        password: mode === "specify" ? typed.trim() : undefined,
        mustChange,
      });
      setIssued(password);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not reset the password.");
    } finally {
      setSaving(false);
    }
  };

  const copy = async () => {
    if (!issued) return;
    await navigator.clipboard.writeText(issued);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const share = () => {
    if (!issued) return;
    openWhatsApp(
      user.phone,
      `Hope Hospital login details\n\nWebsite: https://adamrit.com\nEmail: ${user.email}\nPassword: ${issued}\n\nPlease log in and change this password straight away.`,
    );
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="h-5 w-5 text-blue-600" />
            {issued ? "New password set" : "Reset password"}
          </DialogTitle>
          <DialogDescription>
            {name} · {user.email}
          </DialogDescription>
        </DialogHeader>

        {!issued ? (
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <label className="flex items-start gap-2 cursor-pointer">
                <input
                  type="radio" className="mt-1"
                  checked={mode === "generate"}
                  onChange={() => setMode("generate")}
                />
                <span>
                  <span className="text-sm font-medium">Generate a strong password</span>
                  <span className="block text-xs text-muted-foreground">
                    12 characters, no look-alike letters, so it can be read aloud.
                  </span>
                </span>
              </label>
              <label className="flex items-start gap-2 cursor-pointer">
                <input
                  type="radio" className="mt-1"
                  checked={mode === "specify"}
                  onChange={() => setMode("specify")}
                />
                <span className="text-sm font-medium">Set a specific password</span>
              </label>
            </div>

            {mode === "specify" && (
              <Input
                autoFocus
                type="text"
                placeholder="At least 8 characters"
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
              />
            )}

            <div className="flex items-center gap-2">
              <Checkbox
                id="rp-must-change"
                checked={mustChange}
                onCheckedChange={(v) => setMustChange(v === true)}
              />
              <Label htmlFor="rp-must-change" className="cursor-pointer text-sm">
                Require them to change it at next login
              </Label>
            </div>

            {error && <p className="text-sm text-red-600 bg-red-50 p-2 rounded">{error}</p>}
          </div>
        ) : (
          <div className="space-y-4 py-2">
            <div className="rounded-lg border-2 border-dashed border-blue-300 bg-blue-50 p-4 text-center">
              <p className="font-mono text-xl font-bold tracking-wider break-all text-blue-900">
                {issued}
              </p>
            </div>

            <p className="flex items-start gap-2 text-sm text-red-600">
              <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
              This is the only time this password will be shown. Copy or send it
              before you close this box.
            </p>

            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={copy}>
                {copied ? <Check className="h-4 w-4 mr-1 text-green-600" /> : <Copy className="h-4 w-4 mr-1" />}
                {copied ? "Copied" : "Copy"}
              </Button>
              <Button
                variant="outline" className="flex-1"
                onClick={share}
                disabled={!whatsAppNumber}
                title={whatsAppNumber ? "Send on WhatsApp" : "No usable phone number on this account"}
              >
                <MessageCircle className="h-4 w-4 mr-1 text-green-600" />
                WhatsApp
              </Button>
            </div>
            {!whatsAppNumber && (
              <p className="text-xs text-muted-foreground">
                Add a phone number to this account to send credentials on WhatsApp.
              </p>
            )}
          </div>
        )}

        <DialogFooter>
          {!issued ? (
            <>
              <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
              <Button onClick={submit} disabled={saving}>
                {saving ? "Resetting..." : "Reset password"}
              </Button>
            </>
          ) : (
            <Button onClick={onClose}>Done</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default ResetPasswordDialog;
