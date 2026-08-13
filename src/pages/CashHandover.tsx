import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  BadgeCheck,
  Banknote,
  Printer,
  ShieldCheck,
  TriangleAlert,
  UserCog,
  Users,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  fetchDenominations, fetchHandovers, fetchNominees, fetchPositions, setNominee,
  verifyHandover, type CashHandover,
} from "@/lib/cashHandover";
import { printHandoverSlip } from "@/lib/printHandoverSlip";

const inr = (n: number | null | undefined) =>
  "₹" + Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 });

const when = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString("en-IN", {
        day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
      })
    : "—";

const STATUS_TONE: Record<string, string> = {
  SUBMITTED: "bg-amber-100 text-amber-800",
  ACCEPTED: "bg-blue-100 text-blue-800",
  VERIFIED: "bg-emerald-100 text-emerald-800",
  CANCELLED: "bg-muted text-muted-foreground",
};

export default function CashHandoverPage() {
  const { user, hospitalType } = useAuth();
  const qc = useQueryClient();

  const positions = useQuery({ queryKey: ["cash-positions"], queryFn: fetchPositions });
  const handovers = useQuery({ queryKey: ["cash-handovers"], queryFn: () => fetchHandovers({ limit: 200 }) });
  const nominees = useQuery({ queryKey: ["cash-handover-nominees", "all"], queryFn: () => fetchNominees() });

  const openVariances = useMemo(
    () => (handovers.data ?? []).filter(
      (h) => h.status !== "CANCELLED" && Math.round(h.variance * 100) !== 0,
    ),
    [handovers.data],
  );
  const totalHeld = (positions.data ?? []).reduce((s, p) => s + Number(p.net_cash || 0), 0);

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold">Cash Handover</h1>
        <p className="text-muted-foreground">
          Who is holding the hospital's cash, and the record of it changing hands.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card className="border-l-4 border-l-emerald-500">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Banknote className="h-4 w-4 text-emerald-600" /> Cash at the counter
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{inr(totalHeld)}</p>
            <p className="text-xs text-muted-foreground">
              Collected but not yet handed over
            </p>
          </CardContent>
        </Card>
        <Card className="border-l-4 border-l-amber-500">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <TriangleAlert className="h-4 w-4 text-amber-600" /> Differences recorded
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{openVariances.length}</p>
            <p className="text-xs text-muted-foreground">
              Handovers where the count did not match
            </p>
          </CardContent>
        </Card>
        <Card className="border-l-4 border-l-blue-500">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Users className="h-4 w-4 text-blue-600" /> Nominated people
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{(nominees.data ?? []).length}</p>
            <p className="text-xs text-muted-foreground">Allowed to receive or verify</p>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="holders">
        <TabsList className="flex h-auto flex-wrap">
          <TabsTrigger value="holders">Who is holding cash</TabsTrigger>
          <TabsTrigger value="register">Handover register</TabsTrigger>
          <TabsTrigger value="people">Nominated people</TabsTrigger>
        </TabsList>

        <TabsContent value="holders" className="mt-4">
          <Card>
            <CardContent className="pt-6">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Person</TableHead>
                    <TableHead className="text-right">Cash held</TableHead>
                    <TableHead className="text-right">Receipts</TableHead>
                    <TableHead>Oldest uncollected</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(positions.data ?? []).length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={4} className="py-8 text-center text-muted-foreground">
                        No cash outstanding at the counter.
                      </TableCell>
                    </TableRow>
                  ) : (
                    (positions.data ?? []).map((p) => (
                      <TableRow key={p.holder_user_id ?? "none"}>
                        <TableCell className="font-medium">
                          {p.holder_user_id ? (
                            p.holder_name
                          ) : (
                            <span className="text-amber-700">
                              Not recorded to anyone
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-right font-semibold">
                          {inr(p.net_cash)}
                        </TableCell>
                        <TableCell className="text-right">{p.receipt_count}</TableCell>
                        <TableCell>{when(p.oldest_uncollected)}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="register" className="mt-4">
          <RegisterTable
            rows={handovers.data ?? []}
            currentUserId={user?.id ?? ""}
            orgName={hospitalType ?? "Hospital"}
            canVerify={(nominees.data ?? []).some(
              (n) => n.user_id === user?.id && n.can_verify,
            )}
            onChanged={() => {
              qc.invalidateQueries({ queryKey: ["cash-handovers"] });
              qc.invalidateQueries({ queryKey: ["cash-positions"] });
            }}
          />
        </TabsContent>

        <TabsContent value="people" className="mt-4">
          <NomineeMaster
            nominees={nominees.data ?? []}
            actor={user?.email ?? user?.id ?? null}
            onChanged={() => qc.invalidateQueries({ queryKey: ["cash-handover-nominees"] })}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

/* ---------------------------------------------------------------- register */

function RegisterTable({
  rows, currentUserId, orgName, canVerify, onChanged,
}: {
  rows: CashHandover[];
  currentUserId: string;
  orgName: string;
  canVerify: boolean;
  onChanged: () => void;
}) {
  const verify = useMutation({
    mutationFn: (id: string) => verifyHandover(id, currentUserId),
    onSuccess: () => { toast.success("Count verified."); onChanged(); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not verify"),
  });

  const print = async (h: CashHandover) => {
    const denoms = await fetchDenominations(h.id);
    if (!printHandoverSlip(h, denoms, orgName)) {
      toast.error("Popup blocked — allow popups for this site to print the slip");
    }
  };

  return (
    <Card>
      <CardContent className="overflow-x-auto pt-6">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>No.</TableHead>
              <TableHead>From → To</TableHead>
              <TableHead className="text-right">Counted</TableHead>
              <TableHead className="text-right">Software</TableHead>
              <TableHead className="text-right">Difference</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Submitted</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="py-8 text-center text-muted-foreground">
                  No handovers recorded yet.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((h) => {
                const diff = Number(h.variance || 0);
                return (
                  <TableRow key={h.id}>
                    <TableCell className="font-mono text-xs">{h.handover_no}</TableCell>
                    <TableCell>
                      <div className="font-medium">{h.from_user_name}</div>
                      <div className="text-xs text-muted-foreground">→ {h.to_user_name}</div>
                    </TableCell>
                    <TableCell className="text-right font-semibold">{inr(h.counted_cash)}</TableCell>
                    <TableCell className="text-right">{inr(h.expected_cash)}</TableCell>
                    <TableCell className="text-right">
                      {Math.round(diff * 100) === 0 ? (
                        <span className="text-emerald-700">—</span>
                      ) : (
                        <span className="font-semibold text-amber-700" title={h.variance_reason ?? ""}>
                          {diff > 0 ? "+" : "−"}{inr(Math.abs(diff))}
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge className={STATUS_TONE[h.status]} variant="secondary">
                        {h.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs">{when(h.submitted_at)}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        {h.status === "ACCEPTED" && canVerify && h.from_user_id !== currentUserId && (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={verify.isPending}
                            onClick={() => verify.mutate(h.id)}
                          >
                            <BadgeCheck className="mr-1 h-4 w-4" /> Verify
                          </Button>
                        )}
                        <Button size="sm" variant="ghost" onClick={() => print(h)}>
                          <Printer className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

/* ----------------------------------------------------------- nominee master */

const HOSPITAL_SCOPES = [
  { key: "*", label: "All hospitals" },
  { key: "hope", label: "Hope" },
  { key: "ayushman", label: "Ayushman Nagpur" },
] as const;

function NomineeMaster({
  nominees, actor, onChanged,
}: {
  nominees: {
    user_id: string; display_name: string;
    can_receive: boolean; can_verify: boolean; hospital_type: string;
  }[];
  actor: string | null;
  onChanged: () => void;
}) {
  const [search, setSearch] = useState("");
  // Rights are granted per counter. Everything below applies to this scope.
  const [scope, setScope] = useState<string>("*");

  const users = useQuery({
    queryKey: ["cash-handover-user-list"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("User")
        .select("id, full_name, email, role")
        .order("full_name");
      if (error) throw new Error(error.message);
      return (data ?? []) as { id: string; full_name: string | null; email: string; role: string }[];
    },
  });

  const save = useMutation({
    mutationFn: (v: { userId: string; canReceive: boolean; canVerify: boolean; isActive: boolean }) =>
      setNominee({ ...v, actor, hospitalType: scope }),
    onSuccess: () => { toast.success("Saved."); onChanged(); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not save"),
  });

  // Only the nominations for the scope on screen, so a Hope row is never
  // mistaken for an Ayushman one.
  const byId = new Map(
    nominees.filter((n) => n.hospital_type === scope).map((n) => [n.user_id, n]),
  );
  const filtered = (users.data ?? []).filter((u) => {
    const q = search.trim().toLowerCase();
    if (!q) return byId.has(u.id);
    return (u.full_name ?? "").toLowerCase().includes(q) || u.email.toLowerCase().includes(q);
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <UserCog className="h-4 w-4" /> Who may receive and verify cash
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Only the people listed here can be handed cash or confirm a count. Rights are
          granted per counter — pick the hospital first. Search to add someone; clear the
          search to see the current list.
        </p>
      </CardHeader>
      <CardContent>
        <div className="mb-4 flex flex-wrap gap-2">
          {HOSPITAL_SCOPES.map((h) => (
            <Button
              key={h.key}
              size="sm"
              variant={scope === h.key ? "default" : "outline"}
              onClick={() => setScope(h.key)}
            >
              {h.label}
            </Button>
          ))}
        </div>
        <input
          className="mb-4 w-full rounded-md border px-3 py-2"
          placeholder="Search staff by name or email to nominate…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Person</TableHead>
              <TableHead className="text-center">Can receive cash</TableHead>
              <TableHead className="text-center">Can verify a count</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={3} className="py-8 text-center text-muted-foreground">
                  {search
                    ? "No staff match that search."
                    : `Nobody is nominated for ${HOSPITAL_SCOPES.find((h) => h.key === scope)?.label}.`}
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((u) => {
                const n = byId.get(u.id);
                return (
                  <TableRow key={u.id}>
                    <TableCell>
                      <div className="font-medium">{u.full_name || u.email}</div>
                      <div className="text-xs text-muted-foreground">{u.email}</div>
                    </TableCell>
                    <TableCell className="text-center">
                      <Switch
                        checked={!!n?.can_receive}
                        onCheckedChange={(v) =>
                          save.mutate({
                            userId: u.id, canReceive: v,
                            canVerify: !!n?.can_verify,
                            isActive: v || !!n?.can_verify,
                          })
                        }
                      />
                    </TableCell>
                    <TableCell className="text-center">
                      <Switch
                        checked={!!n?.can_verify}
                        onCheckedChange={(v) =>
                          save.mutate({
                            userId: u.id, canReceive: !!n?.can_receive,
                            canVerify: v, isActive: v || !!n?.can_receive,
                          })
                        }
                      />
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
        <p className="mt-4 flex items-center gap-2 text-xs text-muted-foreground">
          <ShieldCheck className="h-3.5 w-3.5" />
          A person can never verify a count they submitted themselves, whatever is set here.
        </p>
      </CardContent>
    </Card>
  );
}
