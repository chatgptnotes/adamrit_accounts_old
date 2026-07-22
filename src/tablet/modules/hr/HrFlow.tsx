import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { addDays, endOfMonth, format, parseISO, startOfMonth, subMonths } from "date-fns";
import {
  AlertTriangle,
  Banknote,
  CalendarDays,
  Clock3,
  Download,
  FileText,
  RefreshCw,
  Send,
  ShieldCheck,
  UserRound,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FlowScaffold } from "@/tablet/components/FlowScaffold";
import { TabletButton } from "@/tablet/ui/TabletButton";
import { TabletCard } from "@/tablet/ui/TabletCard";
import { cn } from "@/lib/utils";

type StaffAttendanceRow = {
  id: string;
  employee_name: string;
  employee_id: string | null;
  department: string | null;
  shift_type: string | null;
  work_date: string;
  check_in_at: string | null;
  check_out_at: string | null;
  duration_minutes: number | null;
  status: string | null;
  notes: string | null;
};

type StaffMemberRow = {
  id: string;
  name: string;
  role: string;
  specialization: string | null;
  availability_status: string;
  current_assignment: string | null;
  shift_start: string;
  shift_end: string;
};

type HrLeaveRequest = {
  id: string;
  employee_id: string | null;
  employee_name: string;
  employee_email: string | null;
  leave_type: string;
  start_date: string;
  end_date: string;
  reason: string | null;
  status: string;
  requested_at: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_note: string | null;
};

type HrPayrollSlip = {
  id: string;
  employee_id: string | null;
  employee_name: string;
  employee_email: string | null;
  payroll_month: string;
  gross_salary: number | null;
  deductions: number | null;
  net_salary: number | null;
  generated_at: string | null;
  verified_at: string | null;
  verified_by: string | null;
  slip_url: string | null;
};

const LATE_CUTOFF_HOUR = 9;
const LATE_CUTOFF_MINUTE = 15;
const LOOKBACK_DAYS = 90;

const normalize = (value?: string | null) =>
  (value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const money = (value?: number | null) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(Number(value || 0));

const dateLabel = (value?: string | null) => {
  if (!value) return "-";
  try {
    return format(parseISO(value), "dd MMM yyyy");
  } catch {
    return value;
  }
};

const timeLabel = (value?: string | null) => {
  if (!value) return "-";
  try {
    return format(parseISO(value), "hh:mm a");
  } catch {
    return "-";
  }
};

const isLateRecord = (row: StaffAttendanceRow) => {
  if (normalize(row.status).includes("late") || normalize(row.notes).includes("late")) return true;
  if (!row.check_in_at) return false;
  const checkIn = parseISO(row.check_in_at);
  return checkIn.getHours() > LATE_CUTOFF_HOUR || (checkIn.getHours() === LATE_CUTOFF_HOUR && checkIn.getMinutes() > LATE_CUTOFF_MINUTE);
};

const daysBetweenInclusive = (start: string, end: string) => {
  const startMs = parseISO(start).setHours(0, 0, 0, 0);
  const endMs = parseISO(end).setHours(0, 0, 0, 0);
  return Math.max(1, Math.round((endMs - startMs) / 86400000) + 1);
};

const matchesCurrentUser = (row: { employee_id?: string | null; employee_name?: string | null; employee_email?: string | null }, user: { id?: string; email: string; username: string } | null) => {
  if (!user) return false;
  const userTokens = [user.id, user.email, user.username, user.email.split("@")[0]].map(normalize).filter(Boolean);
  const rowTokens = [row.employee_id, row.employee_email, row.employee_name].map(normalize).filter(Boolean);
  return rowTokens.some((rowToken) =>
    userTokens.some((userToken) => rowToken === userToken || rowToken.includes(userToken) || userToken.includes(rowToken)),
  );
};

const deriveConsecutiveLateDays = (records: StaffAttendanceRow[]) => {
  const sorted = [...records].sort((a, b) => b.work_date.localeCompare(a.work_date));
  let streak = 0;
  for (const row of sorted) {
    if (!row.check_in_at && row.status !== "present") continue;
    if (!isLateRecord(row)) break;
    streak += 1;
  }
  return streak;
};

async function safeSelect<T>(table: string, build: (query: any) => PromiseLike<{ data: T[] | null; error: any }>) {
  const { data, error } = await build((supabase as any).from(table));
  if (error) {
    const message = String(error.message || "");
    if (message.includes("does not exist") || error.code === "42P01" || error.code === "PGRST205") return [];
    throw error;
  }
  return data || [];
}

function buildPdfSlip(row: HrPayrollSlip, employeeName: string, attendance: StaffAttendanceRow[]) {
  import("jspdf").then(({ jsPDF }) => {
    const doc = new jsPDF();
    const presentDays = attendance.filter((r) => r.status !== "absent" && r.check_in_at).length;
    const lateDays = attendance.filter(isLateRecord).length;
    const leaveDays = attendance.filter((r) => r.status === "on_leave").length;

    doc.setFont("helvetica", "bold");
    doc.setFontSize(16);
    doc.text("Hope Multi-Specialty Hospital", 14, 18);
    doc.setFontSize(13);
    doc.text("Monthly Salary Slip", 14, 30);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.text(`Employee: ${employeeName}`, 14, 46);
    doc.text(`Month: ${row.payroll_month}`, 14, 54);
    doc.text(`Generated: ${dateLabel(row.generated_at)}`, 14, 62);
    doc.text(`Present days: ${presentDays}`, 14, 78);
    doc.text(`Late days: ${lateDays}`, 14, 86);
    doc.text(`Leave days: ${leaveDays}`, 14, 94);
    doc.text(`Gross salary: ${money(row.gross_salary)}`, 14, 112);
    doc.text(`Deductions: ${money(row.deductions)}`, 14, 120);
    doc.setFont("helvetica", "bold");
    doc.text(`Net salary: ${money(row.net_salary)}`, 14, 132);
    doc.setFont("helvetica", "normal");
    doc.text(`Verified by: ${row.verified_by || "Pending verification"}`, 14, 148);
    doc.save(`salary-slip-${normalize(employeeName).replace(/\s+/g, "-") || "employee"}-${row.payroll_month}.pdf`);
  });
}

export default function HrFlow() {
  const { user, isAdmin, isSuperAdmin } = useAuth();
  const qc = useQueryClient();
  const [activeTab, setActiveTab] = useState<"self" | "admin">("self");
  const [monthOffset, setMonthOffset] = useState(0);
  const [search, setSearch] = useState("");
  const [leaveType, setLeaveType] = useState("Casual Leave");
  const [leaveStart, setLeaveStart] = useState(format(new Date(), "yyyy-MM-dd"));
  const [leaveEnd, setLeaveEnd] = useState(format(new Date(), "yyyy-MM-dd"));
  const [leaveReason, setLeaveReason] = useState("");

  const hasMasterAccess = isAdmin || isSuperAdmin || user?.role === "hr";
  const targetMonth = subMonths(new Date(), monthOffset);
  const monthStart = format(startOfMonth(targetMonth), "yyyy-MM-dd");
  const monthEnd = format(endOfMonth(targetMonth), "yyyy-MM-dd");
  const lookbackStart = format(addDays(new Date(), -LOOKBACK_DAYS), "yyyy-MM-dd");
  const userName = user?.username || user?.email?.split("@")[0] || "Employee";

  const attendanceQuery = useQuery({
    queryKey: ["tablet-hr-attendance", lookbackStart, monthEnd],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("staff_attendance")
        .select("*")
        .gte("work_date", lookbackStart)
        .lte("work_date", monthEnd)
        .order("work_date", { ascending: false })
        .order("employee_name", { ascending: true });
      if (error) throw error;
      return (data || []) as StaffAttendanceRow[];
    },
    refetchInterval: 60000,
    staleTime: 30000,
  });

  const staffQuery = useQuery({
    queryKey: ["tablet-hr-staff-members"],
    queryFn: async () => {
      const { data, error } = await supabase.from("staff_members").select("*").order("name");
      if (error) throw error;
      return (data || []) as StaffMemberRow[];
    },
    staleTime: 120000,
  });

  const leaveQuery = useQuery({
    queryKey: ["tablet-hr-leave-requests"],
    queryFn: () =>
      safeSelect<HrLeaveRequest>("hr_leave_requests", (query) =>
        query.select("*").order("requested_at", { ascending: false }).limit(200),
      ),
    staleTime: 30000,
  });

  const payrollQuery = useQuery({
    queryKey: ["tablet-hr-payroll-slips", monthStart, monthEnd],
    queryFn: () =>
      safeSelect<HrPayrollSlip>("hr_payroll_slips", (query) =>
        query.select("*").gte("payroll_month", monthStart).lte("payroll_month", monthEnd).order("employee_name"),
      ),
    staleTime: 60000,
  });

  const attendance = attendanceQuery.data || [];
  const staff = staffQuery.data || [];
  const leaveRequests = leaveQuery.data || [];
  const payrollSlips = payrollQuery.data || [];

  const visibleAttendance = useMemo(() => {
    const monthRows = attendance.filter((row) => row.work_date >= monthStart && row.work_date <= monthEnd);
    return hasMasterAccess ? monthRows : monthRows.filter((row) => matchesCurrentUser(row, user));
  }, [attendance, hasMasterAccess, monthEnd, monthStart, user]);

  const personalAttendance = useMemo(
    () => attendance.filter((row) => matchesCurrentUser(row, user)),
    [attendance, user],
  );

  const visibleLeaveRequests = useMemo(
    () => (hasMasterAccess ? leaveRequests : leaveRequests.filter((row) => matchesCurrentUser(row, user))),
    [hasMasterAccess, leaveRequests, user],
  );

  const visiblePayroll = useMemo(
    () => (hasMasterAccess ? payrollSlips : payrollSlips.filter((row) => matchesCurrentUser(row, user))),
    [hasMasterAccess, payrollSlips, user],
  );

  const filteredEmployees = useMemo(() => {
    const term = normalize(search);
    const byName = new Map<string, { name: string; employeeId: string | null; department: string | null; role: string | null }>();
    for (const row of visibleAttendance) {
      if (!byName.has(row.employee_name)) {
        byName.set(row.employee_name, {
          name: row.employee_name,
          employeeId: row.employee_id,
          department: row.department,
          role: null,
        });
      }
    }
    for (const member of staff) {
      if (!hasMasterAccess && !matchesCurrentUser({ employee_name: member.name, employee_id: member.id }, user)) continue;
      const existing = byName.get(member.name);
      byName.set(member.name, {
        name: member.name,
        employeeId: member.id,
        department: member.specialization || existing?.department || null,
        role: member.role || existing?.role || null,
      });
    }
    return Array.from(byName.values())
      .filter((row) => !term || normalize(`${row.name} ${row.employeeId || ""} ${row.department || ""} ${row.role || ""}`).includes(term))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [hasMasterAccess, search, staff, user, visibleAttendance]);

  const consecutiveLateDays = deriveConsecutiveLateDays(personalAttendance);
  const presentCount = visibleAttendance.filter((row) => row.status !== "absent" && row.check_in_at).length;
  const lateCount = visibleAttendance.filter(isLateRecord).length;
  const leaveDaysUsed = visibleAttendance.filter((row) => row.status === "on_leave").length;
  const pendingLeaves = visibleLeaveRequests.filter((row) => row.status === "pending").length;
  const verifiedPayroll = visiblePayroll.filter((row) => row.verified_at).length;

  const submitLeave = useMutation({
    mutationFn: async () => {
      if (!user) throw new Error("Login required.");
      if (!leaveStart || !leaveEnd) throw new Error("Select leave dates.");
      if (leaveEnd < leaveStart) throw new Error("End date cannot be before start date.");
      const payload = {
        employee_id: user.id || user.email,
        employee_name: userName,
        employee_email: user.email,
        leave_type: leaveType,
        start_date: leaveStart,
        end_date: leaveEnd,
        reason: leaveReason.trim() || null,
        status: "pending",
      };
      const { error } = await (supabase as any).from("hr_leave_requests").insert(payload);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Leave request sent to SuperAdmin");
      setLeaveReason("");
      qc.invalidateQueries({ queryKey: ["tablet-hr-leave-requests"] });
    },
    onError: (error: Error) => {
      toast.error(error.message.includes("does not exist") ? "HR leave table is not applied in Supabase yet." : error.message);
    },
  });

  const reviewLeave = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: "approved" | "rejected" }) => {
      const { error } = await (supabase as any)
        .from("hr_leave_requests")
        .update({
          status,
          reviewed_by: user?.email || user?.username || "admin",
          reviewed_at: new Date().toISOString(),
        })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Leave request updated");
      qc.invalidateQueries({ queryKey: ["tablet-hr-leave-requests"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <FlowScaffold
      heading="HR"
      subheading="Attendance, leave requests, late alerts, payroll verification, and salary slips."
      actions={
        <TabletButton
          variant="outline"
          className="w-full"
          onClick={() => {
            qc.invalidateQueries({ queryKey: ["tablet-hr-attendance"] });
            qc.invalidateQueries({ queryKey: ["tablet-hr-leave-requests"] });
            qc.invalidateQueries({ queryKey: ["tablet-hr-payroll-slips"] });
          }}
        >
          <RefreshCw className="mr-2 h-5 w-5" />
          Refresh
        </TabletButton>
      }
    >
      <div className="space-y-4 pb-20">
        {hasMasterAccess ? (
          <div className="grid grid-cols-2 gap-2 rounded-2xl border bg-muted/40 p-1">
            <button
              type="button"
              className={cn("rounded-xl px-4 py-3 text-sm font-semibold", activeTab === "self" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground")}
              onClick={() => setActiveTab("self")}
            >
              My portal
            </button>
            <button
              type="button"
              className={cn("rounded-xl px-4 py-3 text-sm font-semibold", activeTab === "admin" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground")}
              onClick={() => setActiveTab("admin")}
            >
              Master dashboard
            </button>
          </div>
        ) : null}

        {consecutiveLateDays >= 3 ? (
          <TabletCard className="border-amber-300 bg-amber-50 text-amber-950">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
              <div>
                <p className="font-semibold">Late attendance warning</p>
                <p className="text-sm">You have {consecutiveLateDays} consecutive late check-ins. Please regularize attendance with HR.</p>
              </div>
            </div>
          </TabletCard>
        ) : null}

        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <MetricCard label="Present days" value={presentCount} icon={Users} tone="blue" />
          <MetricCard label="Late days" value={lateCount} icon={Clock3} tone="amber" />
          <MetricCard label="Leave days" value={leaveDaysUsed} icon={CalendarDays} tone="rose" />
          <MetricCard label={hasMasterAccess && activeTab === "admin" ? "Payroll verified" : "Salary slips"} value={hasMasterAccess && activeTab === "admin" ? `${verifiedPayroll}/${visiblePayroll.length}` : visiblePayroll.length} icon={Banknote} tone="emerald" />
        </div>

        {hasMasterAccess && activeTab === "admin" ? (
          <AdminDashboard
            monthOffset={monthOffset}
            setMonthOffset={setMonthOffset}
            monthLabel={format(targetMonth, "MMMM yyyy")}
            search={search}
            setSearch={setSearch}
            attendance={visibleAttendance}
            employees={filteredEmployees}
            leaveRequests={visibleLeaveRequests}
            pendingLeaves={pendingLeaves}
            payrollSlips={visiblePayroll}
            reviewLeave={(id, status) => reviewLeave.mutate({ id, status })}
            reviewing={reviewLeave.isPending}
          />
        ) : (
          <SelfServicePortal
            monthOffset={monthOffset}
            setMonthOffset={setMonthOffset}
            monthLabel={format(targetMonth, "MMMM yyyy")}
            employeeName={personalAttendance[0]?.employee_name || userName}
            attendance={visibleAttendance}
            leaveRequests={visibleLeaveRequests}
            payrollSlips={visiblePayroll}
            leaveType={leaveType}
            setLeaveType={setLeaveType}
            leaveStart={leaveStart}
            setLeaveStart={setLeaveStart}
            leaveEnd={leaveEnd}
            setLeaveEnd={setLeaveEnd}
            leaveReason={leaveReason}
            setLeaveReason={setLeaveReason}
            submitLeave={() => submitLeave.mutate()}
            submittingLeave={submitLeave.isPending}
          />
        )}
      </div>
    </FlowScaffold>
  );
}

function MetricCard({ label, value, icon: Icon, tone }: { label: string; value: string | number; icon: typeof Users; tone: "blue" | "amber" | "rose" | "emerald" }) {
  const toneClass = {
    blue: "bg-blue-50 text-blue-900 border-blue-100",
    amber: "bg-amber-50 text-amber-950 border-amber-100",
    rose: "bg-rose-50 text-rose-950 border-rose-100",
    emerald: "bg-emerald-50 text-emerald-950 border-emerald-100",
  }[tone];

  return (
    <TabletCard className={cn("space-y-2", toneClass)}>
      <Icon className="h-5 w-5" />
      <p className="text-xs font-semibold uppercase tracking-normal opacity-70">{label}</p>
      <p className="text-2xl font-bold">{value}</p>
    </TabletCard>
  );
}

function SelfServicePortal(props: {
  monthOffset: number;
  setMonthOffset: (value: number) => void;
  monthLabel: string;
  employeeName: string;
  attendance: StaffAttendanceRow[];
  leaveRequests: HrLeaveRequest[];
  payrollSlips: HrPayrollSlip[];
  leaveType: string;
  setLeaveType: (value: string) => void;
  leaveStart: string;
  setLeaveStart: (value: string) => void;
  leaveEnd: string;
  setLeaveEnd: (value: string) => void;
  leaveReason: string;
  setLeaveReason: (value: string) => void;
  submitLeave: () => void;
  submittingLeave: boolean;
}) {
  const latestSlip = props.payrollSlips[0];

  return (
    <div className="space-y-4">
      <TabletCard className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold uppercase tracking-normal text-muted-foreground">Employee portal</p>
            <h3 className="truncate text-xl font-bold">{props.employeeName}</h3>
          </div>
          <ShieldCheck className="h-8 w-8 shrink-0 text-primary" />
        </div>
        <MonthSelect value={props.monthOffset} onChange={props.setMonthOffset} />
      </TabletCard>

      <TabletCard className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="font-semibold">Salary slip</p>
            <p className="text-sm text-muted-foreground">{props.monthLabel}</p>
          </div>
          <TabletButton
            variant="outline"
            disabled={!latestSlip}
            onClick={() => latestSlip && buildPdfSlip(latestSlip, props.employeeName, props.attendance)}
          >
            <Download className="mr-2 h-5 w-5" />
            PDF
          </TabletButton>
        </div>
        {latestSlip ? (
          <div className="grid grid-cols-3 gap-2 text-sm">
            <AmountTile label="Gross" value={money(latestSlip.gross_salary)} />
            <AmountTile label="Deductions" value={money(latestSlip.deductions)} />
            <AmountTile label="Net" value={money(latestSlip.net_salary)} />
          </div>
        ) : (
          <p className="rounded-xl bg-muted p-3 text-sm text-muted-foreground">No payroll slip is available for this month yet. It will appear here after HRPulse payroll sync.</p>
        )}
      </TabletCard>

      <TabletCard className="space-y-3">
        <p className="font-semibold">Submit leave request</p>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <Select value={props.leaveType} onValueChange={props.setLeaveType}>
            <SelectTrigger className="min-h-[48px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="Casual Leave">Casual Leave</SelectItem>
              <SelectItem value="Sick Leave">Sick Leave</SelectItem>
              <SelectItem value="Emergency Leave">Emergency Leave</SelectItem>
            </SelectContent>
          </Select>
          <Input type="date" value={props.leaveStart} onChange={(event) => props.setLeaveStart(event.target.value)} className="min-h-[48px]" />
          <Input type="date" value={props.leaveEnd} onChange={(event) => props.setLeaveEnd(event.target.value)} className="min-h-[48px]" />
        </div>
        <Textarea value={props.leaveReason} onChange={(event) => props.setLeaveReason(event.target.value)} placeholder="Reason for leave" className="min-h-[96px]" />
        <TabletButton onClick={props.submitLeave} disabled={props.submittingLeave}>
          <Send className="mr-2 h-5 w-5" />
          {props.submittingLeave ? "Sending..." : "Send to SuperAdmin"}
        </TabletButton>
      </TabletCard>

      <AttendanceList attendance={props.attendance} title="My attendance logs" />
      <LeaveList rows={props.leaveRequests} />
    </div>
  );
}

function AdminDashboard(props: {
  monthOffset: number;
  setMonthOffset: (value: number) => void;
  monthLabel: string;
  search: string;
  setSearch: (value: string) => void;
  attendance: StaffAttendanceRow[];
  employees: { name: string; employeeId: string | null; department: string | null; role: string | null }[];
  leaveRequests: HrLeaveRequest[];
  pendingLeaves: number;
  payrollSlips: HrPayrollSlip[];
  reviewLeave: (id: string, status: "approved" | "rejected") => void;
  reviewing: boolean;
}) {
  const lateEmployees = useMemo(() => {
    const grouped = props.attendance.reduce<Record<string, StaffAttendanceRow[]>>((acc, row) => {
      acc[row.employee_name] ||= [];
      acc[row.employee_name].push(row);
      return acc;
    }, {});
    return Object.entries(grouped)
      .map(([name, rows]) => ({ name, streak: deriveConsecutiveLateDays(rows), lateDays: rows.filter(isLateRecord).length }))
      .filter((row) => row.streak >= 3 || row.lateDays > 0)
      .sort((a, b) => b.streak - a.streak || b.lateDays - a.lateDays)
      .slice(0, 8);
  }, [props.attendance]);

  return (
    <div className="space-y-4">
      <TabletCard className="space-y-3">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="font-semibold">SuperAdmin HR command dashboard</p>
            <p className="text-sm text-muted-foreground">{props.monthLabel} organization view</p>
          </div>
          <MonthSelect value={props.monthOffset} onChange={props.setMonthOffset} />
        </div>
        <Input value={props.search} onChange={(event) => props.setSearch(event.target.value)} placeholder="Search employee, ID, department, role" className="min-h-[52px]" />
      </TabletCard>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <TabletCard className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="font-semibold">Employees</p>
            <Badge variant="outline">{props.employees.length}</Badge>
          </div>
          <div className="space-y-2">
            {props.employees.slice(0, 12).map((employee) => (
              <div key={`${employee.name}-${employee.employeeId || ""}`} className="rounded-xl border bg-background p-3">
                <p className="font-semibold">{employee.name}</p>
                <p className="text-sm text-muted-foreground">{employee.employeeId || "No employee ID"}{employee.department ? ` | ${employee.department}` : ""}{employee.role ? ` | ${employee.role}` : ""}</p>
              </div>
            ))}
            {props.employees.length === 0 ? <p className="text-sm text-muted-foreground">No employees found.</p> : null}
          </div>
        </TabletCard>

        <TabletCard className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="font-semibold">Late attendance alerts</p>
            <Badge className="bg-amber-100 text-amber-900 hover:bg-amber-100">{lateEmployees.length}</Badge>
          </div>
          <div className="space-y-2">
            {lateEmployees.map((row) => (
              <div key={row.name} className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-amber-950">
                <p className="font-semibold">{row.name}</p>
                <p className="text-sm">{row.streak >= 3 ? `${row.streak} consecutive late days` : `${row.lateDays} late day(s) this month`}</p>
              </div>
            ))}
            {lateEmployees.length === 0 ? <p className="text-sm text-muted-foreground">No late attendance alerts.</p> : null}
          </div>
        </TabletCard>
      </div>

      <TabletCard className="space-y-3">
        <div className="flex items-center justify-between">
          <p className="font-semibold">Leave requests</p>
          <Badge variant={props.pendingLeaves ? "default" : "outline"}>{props.pendingLeaves} pending</Badge>
        </div>
        <div className="space-y-2">
          {props.leaveRequests.slice(0, 12).map((row) => (
            <div key={row.id} className="rounded-xl border bg-background p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="font-semibold">{row.employee_name}</p>
                  <p className="text-sm text-muted-foreground">{row.leave_type} | {dateLabel(row.start_date)} to {dateLabel(row.end_date)} | {daysBetweenInclusive(row.start_date, row.end_date)} day(s)</p>
                  {row.reason ? <p className="mt-1 text-sm">{row.reason}</p> : null}
                </div>
                <StatusBadge value={row.status} />
              </div>
              {row.status === "pending" ? (
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <TabletButton size="sm" className="min-h-[44px] text-sm" disabled={props.reviewing} onClick={() => props.reviewLeave(row.id, "approved")}>Approve</TabletButton>
                  <TabletButton size="sm" variant="outline" className="min-h-[44px] text-sm" disabled={props.reviewing} onClick={() => props.reviewLeave(row.id, "rejected")}>Reject</TabletButton>
                </div>
              ) : null}
            </div>
          ))}
          {props.leaveRequests.length === 0 ? <p className="text-sm text-muted-foreground">No leave requests found. Apply the HR migration to enable live leave approvals.</p> : null}
        </div>
      </TabletCard>

      <TabletCard className="space-y-3">
        <div className="flex items-center justify-between">
          <p className="font-semibold">Payroll verification</p>
          <Badge variant="outline">{props.payrollSlips.length} slips</Badge>
        </div>
        <div className="space-y-2">
          {props.payrollSlips.slice(0, 12).map((row) => (
            <div key={row.id} className="grid grid-cols-1 gap-2 rounded-xl border bg-background p-3 md:grid-cols-[1fr_auto] md:items-center">
              <div>
                <p className="font-semibold">{row.employee_name}</p>
                <p className="text-sm text-muted-foreground">{row.payroll_month} | Gross {money(row.gross_salary)} | Net {money(row.net_salary)}</p>
              </div>
              <Badge variant={row.verified_at ? "default" : "outline"}>{row.verified_at ? "Verified" : "Pending"}</Badge>
            </div>
          ))}
          {props.payrollSlips.length === 0 ? <p className="text-sm text-muted-foreground">No payroll slips found for this month. They will appear after HRPulse payroll sync.</p> : null}
        </div>
      </TabletCard>

      <AttendanceList attendance={props.attendance} title="Organization attendance logs" />
    </div>
  );
}

function MonthSelect({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  return (
    <Select value={String(value)} onValueChange={(next) => onChange(Number(next))}>
      <SelectTrigger className="min-h-[48px] w-full md:w-56">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {[0, 1, 2, 3, 4, 5].map((offset) => (
          <SelectItem key={offset} value={String(offset)}>
            {format(subMonths(new Date(), offset), "MMMM yyyy")}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function AmountTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border bg-background p-3">
      <p className="text-xs font-semibold uppercase tracking-normal text-muted-foreground">{label}</p>
      <p className="text-lg font-bold">{value}</p>
    </div>
  );
}

function AttendanceList({ attendance, title }: { attendance: StaffAttendanceRow[]; title: string }) {
  return (
    <TabletCard className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="font-semibold">{title}</p>
        <Badge variant="outline">{attendance.length}</Badge>
      </div>
      <div className="space-y-2">
        {attendance.slice(0, 40).map((row) => (
          <div key={row.id} className="grid grid-cols-[1fr_auto] gap-3 rounded-xl border bg-background p-3">
            <div className="min-w-0">
              <p className="truncate font-semibold">{row.employee_name}</p>
              <p className="text-sm text-muted-foreground">{dateLabel(row.work_date)} | {row.department || "General"} | {row.shift_type || "Shift"}</p>
              <p className="text-sm text-muted-foreground">In {timeLabel(row.check_in_at)} | Out {timeLabel(row.check_out_at)}</p>
            </div>
            <StatusBadge value={isLateRecord(row) ? "late" : row.status || "present"} />
          </div>
        ))}
        {attendance.length === 0 ? <p className="text-sm text-muted-foreground">No attendance logs found for this view.</p> : null}
      </div>
    </TabletCard>
  );
}

function LeaveList({ rows }: { rows: HrLeaveRequest[] }) {
  return (
    <TabletCard className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="font-semibold">Leave history</p>
        <Badge variant="outline">{rows.length}</Badge>
      </div>
      <div className="space-y-2">
        {rows.slice(0, 10).map((row) => (
          <div key={row.id} className="rounded-xl border bg-background p-3">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="font-semibold">{row.leave_type}</p>
                <p className="text-sm text-muted-foreground">{dateLabel(row.start_date)} to {dateLabel(row.end_date)} | {daysBetweenInclusive(row.start_date, row.end_date)} day(s)</p>
              </div>
              <StatusBadge value={row.status} />
            </div>
          </div>
        ))}
        {rows.length === 0 ? <p className="text-sm text-muted-foreground">No leave requests yet.</p> : null}
      </div>
    </TabletCard>
  );
}

function StatusBadge({ value }: { value: string }) {
  const normalized = normalize(value);
  const className = normalized.includes("approved") || normalized.includes("present") || normalized.includes("verified")
    ? "bg-emerald-100 text-emerald-900 hover:bg-emerald-100"
    : normalized.includes("late") || normalized.includes("pending")
      ? "bg-amber-100 text-amber-900 hover:bg-amber-100"
      : normalized.includes("reject") || normalized.includes("absent")
        ? "bg-rose-100 text-rose-900 hover:bg-rose-100"
        : "bg-slate-100 text-slate-900 hover:bg-slate-100";
  return <Badge className={cn("shrink-0", className)}>{value}</Badge>;
}
