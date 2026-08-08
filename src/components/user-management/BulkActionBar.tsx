import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { X, UserCheck, UserX, KeyRound } from "lucide-react";
import { ALL_ROLES } from "@/config/tileAccess";
import type { BulkOp } from "@/hooks/useAdminUsers";
import { HOSPITALS, roleLabel } from "./constants";

interface Props {
  count: number;
  onClear: () => void;
  onApply: (op: BulkOp, value?: unknown) => void;
  busy?: boolean;
}

type Pending = { op: BulkOp; value?: unknown; title: string; body: string };

const BulkActionBar: React.FC<Props> = ({ count, onClear, onApply, busy }) => {
  const [pending, setPending] = useState<Pending | null>(null);

  if (count === 0) return null;
  const people = `${count} ${count === 1 ? "user" : "users"}`;

  return (
    <>
      <div className="sticky bottom-4 z-30 mx-auto w-fit">
        <div className="flex flex-wrap items-center gap-3 rounded-full border bg-white px-4 py-2 shadow-lg">
          <span className="text-sm font-medium whitespace-nowrap">{count} selected</span>
          <div className="h-5 border-l" />

          <Select
            value=""
            onValueChange={(role) => setPending({
              op: "role", value: role,
              title: "Change role?",
              body: `${people} will be given the role ${roleLabel(role)}.`,
            })}
          >
            <SelectTrigger className="h-8 w-[140px]"><SelectValue placeholder="Set role" /></SelectTrigger>
            <SelectContent>
              {ALL_ROLES.map((r) => (
                <SelectItem key={r} value={r}>{roleLabel(r)}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value=""
            onValueChange={(hospital) => setPending({
              op: "hospital", value: hospital,
              title: "Change hospital?",
              body: `${people} will be moved to ${HOSPITALS.find((h) => h.value === hospital)?.label || hospital}.`,
            })}
          >
            <SelectTrigger className="h-8 w-[150px]"><SelectValue placeholder="Set hospital" /></SelectTrigger>
            <SelectContent>
              {HOSPITALS.map((h) => (
                <SelectItem key={h.value} value={h.value}>{h.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Button
            variant="ghost" size="sm" disabled={busy}
            onClick={() => onApply("active", true)}
          >
            <UserCheck className="h-4 w-4 mr-1 text-green-600" />
            Activate
          </Button>

          <Button
            variant="ghost" size="sm" disabled={busy}
            onClick={() => setPending({
              op: "active", value: false,
              title: "Deactivate these users?",
              body: `${people} will be signed out of new sessions and unable to log in until reactivated.`,
            })}
          >
            <UserX className="h-4 w-4 mr-1 text-red-500" />
            Deactivate
          </Button>

          <Button
            variant="ghost" size="sm" disabled={busy}
            onClick={() => setPending({
              op: "force_reset",
              title: "Force a password change?",
              body: `${people} will be made to set a new password the next time they log in. Their current passwords keep working until then.`,
            })}
          >
            <KeyRound className="h-4 w-4 mr-1 text-blue-600" />
            Force password change
          </Button>

          <Button variant="ghost" size="icon" onClick={onClear} title="Clear selection">
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <AlertDialog open={pending !== null} onOpenChange={(open) => !open && setPending(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{pending?.title}</AlertDialogTitle>
            <AlertDialogDescription>{pending?.body}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (pending) onApply(pending.op, pending.value);
                setPending(null);
              }}
            >
              Confirm
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};

export default BulkActionBar;
