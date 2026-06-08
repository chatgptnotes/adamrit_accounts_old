import React, { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { format, subDays, startOfDay, endOfDay } from "date-fns";

// UI Components
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

// Icons
import {
  Activity,
  Users,
  Zap,
  Crown,
  Search,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  Filter,
  BarChart3,
} from "lucide-react";

// Charts
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip as RechartsTooltip,
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  LineChart,
  Line,
  Legend,
  CartesianGrid,
} from "recharts";

// ── Constants ──────────────────────────────────────────────────────────────

const CHART_COLORS = [
  "#3b82f6",
  "#10b981",
  "#f59e0b",
  "#ef4444",
  "#8b5cf6",
  "#ec4899",
  "#06b6d4",
  "#84cc16",
];

const ACTION_TYPES = [
  "user_login",
  "patient_create",
  "patient_edit",
  "relationship_manager_create",
  "bill_create",
  "patient_discharge",
  "form_submit",
  "report_view",
  "report_generate",
  "lab_order_create",
  "prescription_create",
  // Automation engine events — surface what the dispatcher wrote so admins
  // can see exactly which flows fired, were skipped, blocked by safety, or
  // suppressed by the kill switch / rate limit.
  "automation_fired",
  "automation_skipped",
  "automation_blocked_safety",
  "automation_rate_limited",
  "automation_paused",
  // Legacy per-action labels still written by the runtime (kept for filtering
  // historical rows logged before the unified codes were introduced).
  "task_flow_notify",
  "task_flow_whatsapp_intent",
  "task_flow_email_intent",
];

const PAGE_SIZE = 50;

// ── Types ──────────────────────────────────────────────────────────────────

interface ActivityLogRow {
  id: string;
  user_email: string | null;
  role: string | null;
  action: string | null;
  page: string | null;
  details: Record<string, unknown> | null;
  created_at: string;
}

interface SummaryData {
  activeUsersToday: number;
  totalActionsToday: number;
  mostActiveUser: string;
  mostCommonAction: string;
}

interface HourlyData {
  hour: string;
  count: number;
}

interface RoleData {
  name: string;
  value: number;
}

interface TrendData {
  date: string;
  count: number;
}

// ── Component ──────────────────────────────────────────────────────────────

const ActivityLog = () => {
  // Filter state
  const [dateFrom, setDateFrom] = useState(
    format(subDays(new Date(), 7), "yyyy-MM-dd")
  );
  const [dateTo, setDateTo] = useState(format(new Date(), "yyyy-MM-dd"));
  const [emailSearch, setEmailSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const [actionFilter, setActionFilter] = useState("all");

  // Data state
  const [logs, setLogs] = useState<ActivityLogRow[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [currentPage, setCurrentPage] = useState(0);
  const [loading, setLoading] = useState(true);

  // Summary state
  const [summary, setSummary] = useState<SummaryData>({
    activeUsersToday: 0,
    totalActionsToday: 0,
    mostActiveUser: "-",
    mostCommonAction: "-",
  });

  // Chart state
  const [hourlyData, setHourlyData] = useState<HourlyData[]>([]);
  const [roleData, setRoleData] = useState<RoleData[]>([]);
  const [trendData, setTrendData] = useState<TrendData[]>([]);

  // Available roles (fetched from data)
  const [availableRoles, setAvailableRoles] = useState<string[]>([]);

  // ── Fetch summary cards ──────────────────────────────────────────────────

  const fetchSummary = async () => {
    const todayStart = startOfDay(new Date()).toISOString();
    const todayEnd = endOfDay(new Date()).toISOString();

    try {
      // Fetch all today's logs for summary calculations
      const { data: todayLogs, error } = await (supabase as any)
        .from("user_activity_log")
        .select("user_email, action")
        .gte("created_at", todayStart)
        .lte("created_at", todayEnd);

      if (error) {
        console.error("Error fetching summary:", error);
        return;
      }

      if (!todayLogs || todayLogs.length === 0) {
        setSummary({
          activeUsersToday: 0,
          totalActionsToday: 0,
          mostActiveUser: "-",
          mostCommonAction: "-",
        });
        return;
      }

      // Count distinct users
      const uniqueEmails = new Set(
        todayLogs.map((l: any) => l.user_email).filter(Boolean)
      );

      // Most active user
      const userCounts: Record<string, number> = {};
      todayLogs.forEach((l: any) => {
        if (l.user_email) {
          userCounts[l.user_email] = (userCounts[l.user_email] || 0) + 1;
        }
      });
      const mostActiveUser =
        Object.entries(userCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || "-";

      // Most common action
      const actionCounts: Record<string, number> = {};
      todayLogs.forEach((l: any) => {
        if (l.action) {
          actionCounts[l.action] = (actionCounts[l.action] || 0) + 1;
        }
      });
      const mostCommonAction =
        Object.entries(actionCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ||
        "-";

      setSummary({
        activeUsersToday: uniqueEmails.size,
        totalActionsToday: todayLogs.length,
        mostActiveUser,
        mostCommonAction,
      });
    } catch (err) {
      console.error("Error computing summary:", err);
    }
  };

  // ── Fetch chart data ─────────────────────────────────────────────────────

  const fetchChartData = async () => {
    const fromISO = startOfDay(new Date(dateFrom)).toISOString();
    const toISO = endOfDay(new Date(dateTo)).toISOString();

    try {
      // Fetch all logs in the date range for chart calculations
      const { data: chartLogs, error } = await (supabase as any)
        .from("user_activity_log")
        .select("created_at, role, action")
        .gte("created_at", fromISO)
        .lte("created_at", toISO)
        .order("created_at", { ascending: true });

      if (error) {
        console.error("Error fetching chart data:", error);
        return;
      }

      if (!chartLogs || chartLogs.length === 0) {
        setHourlyData([]);
        setRoleData([]);
        setTrendData([]);
        return;
      }

      // Activity by Hour (0-23)
      const hourBuckets: Record<number, number> = {};
      for (let h = 0; h < 24; h++) hourBuckets[h] = 0;
      chartLogs.forEach((l: any) => {
        const hour = new Date(l.created_at).getHours();
        hourBuckets[hour]++;
      });
      setHourlyData(
        Object.entries(hourBuckets).map(([hour, count]) => ({
          hour: `${hour.padStart(2, "0")}:00`,
          count,
        }))
      );

      // Activity by Role
      const roleBuckets: Record<string, number> = {};
      chartLogs.forEach((l: any) => {
        const role = l.role || "Unknown";
        roleBuckets[role] = (roleBuckets[role] || 0) + 1;
      });
      setRoleData(
        Object.entries(roleBuckets).map(([name, value]) => ({ name, value }))
      );

      // Collect distinct roles for the filter dropdown
      const roles = [
        ...new Set(
          chartLogs.map((l: any) => l.role).filter(Boolean) as string[]
        ),
      ];
      setAvailableRoles(roles.sort());

      // Activity Trend - last 7 days
      const trendBuckets: Record<string, number> = {};
      for (let i = 6; i >= 0; i--) {
        const d = format(subDays(new Date(), i), "yyyy-MM-dd");
        trendBuckets[d] = 0;
      }
      chartLogs.forEach((l: any) => {
        const d = format(new Date(l.created_at), "yyyy-MM-dd");
        if (d in trendBuckets) {
          trendBuckets[d]++;
        }
      });
      setTrendData(
        Object.entries(trendBuckets).map(([date, count]) => ({
          date: format(new Date(date), "MMM dd"),
          count,
        }))
      );
    } catch (err) {
      console.error("Error computing chart data:", err);
    }
  };

  // ── Fetch activity log table ─────────────────────────────────────────────

  const fetchLogs = async () => {
    setLoading(true);
    const fromISO = startOfDay(new Date(dateFrom)).toISOString();
    const toISO = endOfDay(new Date(dateTo)).toISOString();

    try {
      let query = (supabase as any)
        .from("user_activity_log")
        .select("*", { count: "exact" })
        .gte("created_at", fromISO)
        .lte("created_at", toISO)
        .order("created_at", { ascending: false })
        .range(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE - 1);

      if (emailSearch.trim()) {
        query = query.ilike("user_email", `%${emailSearch.trim()}%`);
      }

      if (roleFilter && roleFilter !== "all") {
        query = query.eq("role", roleFilter);
      }

      if (actionFilter && actionFilter !== "all") {
        query = query.eq("action", actionFilter);
      }

      const { data, error, count } = await query;

      if (error) {
        console.error("Error fetching logs:", error);
        setLogs([]);
        setTotalCount(0);
      } else {
        setLogs(data || []);
        setTotalCount(count || 0);
      }
    } catch (err) {
      console.error("Error fetching logs:", err);
      setLogs([]);
      setTotalCount(0);
    } finally {
      setLoading(false);
    }
  };

  // ── Effects ──────────────────────────────────────────────────────────────

  useEffect(() => {
    fetchSummary();
  }, []);

  useEffect(() => {
    fetchChartData();
  }, [dateFrom, dateTo]);

  useEffect(() => {
    fetchLogs();
  }, [dateFrom, dateTo, emailSearch, roleFilter, actionFilter, currentPage]);

  // ── Helpers ──────────────────────────────────────────────────────────────

  const totalPages = Math.ceil(totalCount / PAGE_SIZE);

  /** Truncate a JSON string for table display */
  const truncateDetails = (details: Record<string, unknown> | null): string => {
    if (!details) return "-";
    const str = JSON.stringify(details);
    return str.length > 80 ? str.substring(0, 80) + "..." : str;
  };

  /** Get a badge color for common action types */
  const getActionBadgeVariant = (
    action: string | null
  ): "default" | "secondary" | "destructive" | "outline" => {
    if (!action) return "secondary";
    // Automation engine events — distinct colors so admins spot blocks/limits
    // at a glance when scrolling the log.
    if (action === "automation_blocked_safety") return "destructive";
    if (action === "automation_rate_limited" || action === "automation_paused") return "outline";
    if (action === "automation_fired") return "default";
    if (action === "automation_skipped") return "secondary";
    if (action.includes("login")) return "default";
    if (action.includes("create")) return "default";
    if (action.includes("delete") || action.includes("discharge"))
      return "destructive";
    return "secondary";
  };

  const handleRefresh = () => {
    fetchSummary();
    fetchChartData();
    fetchLogs();
  };

  const handleApplyFilters = () => {
    setCurrentPage(0);
    fetchLogs();
  };

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Activity className="h-8 w-8 text-primary" />
            <div>
              <h1 className="text-3xl font-bold text-primary">Activity Log</h1>
              <p className="text-muted-foreground">
                Monitor user activity across the system
              </p>
            </div>
          </div>
          <Button onClick={handleRefresh} variant="outline" size="sm">
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">
                Active Users Today
              </CardTitle>
              <Users className="h-4 w-4 text-blue-600" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-blue-700">
                {summary.activeUsersToday}
              </div>
              <p className="text-xs text-muted-foreground">
                Distinct users with activity
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">
                Total Actions Today
              </CardTitle>
              <Zap className="h-4 w-4 text-green-600" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-green-700">
                {summary.totalActionsToday}
              </div>
              <p className="text-xs text-muted-foreground">
                All recorded actions
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">
                Most Active User
              </CardTitle>
              <Crown className="h-4 w-4 text-amber-600" />
            </CardHeader>
            <CardContent>
              <div
                className="text-lg font-bold text-amber-700 truncate"
                title={summary.mostActiveUser}
              >
                {summary.mostActiveUser}
              </div>
              <p className="text-xs text-muted-foreground">
                Highest action count today
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">
                Most Common Action
              </CardTitle>
              <BarChart3 className="h-4 w-4 text-purple-600" />
            </CardHeader>
            <CardContent>
              <div className="text-lg font-bold text-purple-700">
                {summary.mostCommonAction}
              </div>
              <p className="text-xs text-muted-foreground">
                Top action type today
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Filters Row */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Filter className="h-4 w-4" />
              Filters
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
              {/* Date From */}
              <div className="space-y-1">
                <label className="text-sm font-medium text-muted-foreground">
                  From Date
                </label>
                <Input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => {
                    setDateFrom(e.target.value);
                    setCurrentPage(0);
                  }}
                />
              </div>

              {/* Date To */}
              <div className="space-y-1">
                <label className="text-sm font-medium text-muted-foreground">
                  To Date
                </label>
                <Input
                  type="date"
                  value={dateTo}
                  onChange={(e) => {
                    setDateTo(e.target.value);
                    setCurrentPage(0);
                  }}
                />
              </div>

              {/* Email Search */}
              <div className="space-y-1">
                <label className="text-sm font-medium text-muted-foreground">
                  User Email
                </label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search by email..."
                    value={emailSearch}
                    onChange={(e) => {
                      setEmailSearch(e.target.value);
                      setCurrentPage(0);
                    }}
                    className="pl-9"
                  />
                </div>
              </div>

              {/* Role Filter */}
              <div className="space-y-1">
                <label className="text-sm font-medium text-muted-foreground">
                  Role
                </label>
                <Select
                  value={roleFilter}
                  onValueChange={(val) => {
                    setRoleFilter(val);
                    setCurrentPage(0);
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="All Roles" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Roles</SelectItem>
                    {availableRoles.map((role) => (
                      <SelectItem key={role} value={role}>
                        {role}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Action Type Filter */}
              <div className="space-y-1">
                <label className="text-sm font-medium text-muted-foreground">
                  Action Type
                </label>
                <Select
                  value={actionFilter}
                  onValueChange={(val) => {
                    setActionFilter(val);
                    setCurrentPage(0);
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="All Actions" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Actions</SelectItem>
                    {ACTION_TYPES.map((action) => (
                      <SelectItem key={action} value={action}>
                        {action.replace(/_/g, " ")}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Charts Section */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Activity by Hour */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Activity by Hour</CardTitle>
            </CardHeader>
            <CardContent>
              {hourlyData.length > 0 ? (
                <ResponsiveContainer width="100%" height={250}>
                  <BarChart data={hourlyData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis
                      dataKey="hour"
                      tick={{ fontSize: 10 }}
                      interval={2}
                    />
                    <YAxis allowDecimals={false} />
                    <RechartsTooltip />
                    <Bar dataKey="count" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-[250px] flex items-center justify-center text-muted-foreground text-sm">
                  No data available
                </div>
              )}
            </CardContent>
          </Card>

          {/* Activity by Role */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Activity by Role</CardTitle>
            </CardHeader>
            <CardContent>
              {roleData.length > 0 ? (
                <ResponsiveContainer width="100%" height={250}>
                  <PieChart>
                    <Pie
                      data={roleData}
                      cx="50%"
                      cy="50%"
                      outerRadius={80}
                      dataKey="value"
                      nameKey="name"
                      label={({ name, percent }) =>
                        `${name} (${(percent * 100).toFixed(0)}%)`
                      }
                    >
                      {roleData.map((_, index) => (
                        <Cell
                          key={`cell-${index}`}
                          fill={CHART_COLORS[index % CHART_COLORS.length]}
                        />
                      ))}
                    </Pie>
                    <RechartsTooltip />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-[250px] flex items-center justify-center text-muted-foreground text-sm">
                  No data available
                </div>
              )}
            </CardContent>
          </Card>

          {/* Activity Trend - Last 7 Days */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">
                Activity Trend (Last 7 Days)
              </CardTitle>
            </CardHeader>
            <CardContent>
              {trendData.length > 0 ? (
                <ResponsiveContainer width="100%" height={250}>
                  <LineChart data={trendData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                    <YAxis allowDecimals={false} />
                    <RechartsTooltip />
                    <Legend />
                    <Line
                      type="monotone"
                      dataKey="count"
                      stroke="#3b82f6"
                      strokeWidth={2}
                      dot={{ fill: "#3b82f6", r: 4 }}
                      name="Actions"
                    />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-[250px] flex items-center justify-center text-muted-foreground text-sm">
                  No data available
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Activity Table */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">Activity Records</CardTitle>
              <span className="text-sm text-muted-foreground">
                {totalCount} total record{totalCount !== 1 ? "s" : ""}
              </span>
            </div>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="text-center py-12 text-muted-foreground">
                Loading activity logs...
              </div>
            ) : logs.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <Activity className="h-12 w-12 mx-auto mb-4 opacity-40" />
                <p>No activity logs found for the selected filters.</p>
              </div>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-[180px]">Timestamp</TableHead>
                        <TableHead>User Email</TableHead>
                        <TableHead>Role</TableHead>
                        <TableHead>Action</TableHead>
                        <TableHead>Page</TableHead>
                        <TableHead className="w-[250px]">Details</TableHead>
                        <TableHead className="w-[100px]">Undo</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {logs.map((log) => (
                        <TableRow key={log.id}>
                          <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                            {format(
                              new Date(log.created_at),
                              "dd MMM yyyy, hh:mm:ss a"
                            )}
                          </TableCell>
                          <TableCell className="font-medium text-sm">
                            {log.user_email || "-"}
                          </TableCell>
                          <TableCell>
                            {log.role ? (
                              <Badge variant="outline">{log.role}</Badge>
                            ) : (
                              <span className="text-muted-foreground">-</span>
                            )}
                          </TableCell>
                          <TableCell>
                            {log.action ? (
                              <Badge
                                variant={getActionBadgeVariant(log.action)}
                              >
                                {log.action.replace(/_/g, " ")}
                              </Badge>
                            ) : (
                              <span className="text-muted-foreground">-</span>
                            )}
                          </TableCell>
                          <TableCell className="text-sm">
                            {log.page || "-"}
                          </TableCell>
                          <TableCell
                            className="text-xs text-muted-foreground max-w-[250px] truncate"
                            title={
                              log.details
                                ? JSON.stringify(log.details)
                                : undefined
                            }
                          >
                            {truncateDetails(log.details)}
                          </TableCell>
                          <TableCell className="text-xs">
                            <AutomationUndoCell log={log} />
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>

                {/* Pagination */}
                {totalPages > 1 && (
                  <div className="flex items-center justify-between mt-4 pt-4 border-t">
                    <p className="text-sm text-muted-foreground">
                      Showing {currentPage * PAGE_SIZE + 1} -{" "}
                      {Math.min((currentPage + 1) * PAGE_SIZE, totalCount)} of{" "}
                      {totalCount}
                    </p>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={currentPage === 0}
                        onClick={() => setCurrentPage((p) => p - 1)}
                      >
                        <ChevronLeft className="h-4 w-4 mr-1" />
                        Previous
                      </Button>
                      <span className="text-sm text-muted-foreground px-2">
                        Page {currentPage + 1} of {totalPages}
                      </span>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={currentPage >= totalPages - 1}
                        onClick={() => setCurrentPage((p) => p + 1)}
                      >
                        Next
                        <ChevronRight className="h-4 w-4 ml-1" />
                      </Button>
                    </div>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default ActivityLog;

// ── Automation Undo (Rule 14) ──────────────────────────────────────
// One-shot per row: when an automation_fired row carries action.undo info AND
// is younger than the 30-second window, render a button that issues the
// inverse update (priorValue back into rowId.column). Disabled outside the
// window, hidden when there's nothing to undo.
interface UndoDescriptor {
  table: 'task_optimizer_actions';
  rowId: string;
  column: 'note' | 'status';
  priorValue: string | null;
}

const UNDO_WINDOW_MS = 30_000;

function pickUndoFromDetails(details: ActivityLogRow['details']): UndoDescriptor | null {
  if (!details) return null;
  const actions = (details as { actions?: unknown }).actions;
  if (!Array.isArray(actions)) return null;
  for (const a of actions) {
    if (a && typeof a === 'object') {
      const undo = (a as { undo?: unknown }).undo;
      if (
        undo &&
        typeof undo === 'object' &&
        typeof (undo as UndoDescriptor).rowId === 'string' &&
        ((undo as UndoDescriptor).column === 'note' || (undo as UndoDescriptor).column === 'status')
      ) {
        return undo as UndoDescriptor;
      }
    }
  }
  return null;
}

const AutomationUndoCell: React.FC<{ log: ActivityLogRow }> = ({ log }) => {
  const undo = log.action === 'automation_fired' ? pickUndoFromDetails(log.details) : null;
  const [reverted, setReverted] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);

  // Tick once a second while the row is still in-window so the button greys
  // out the moment 30s elapses. Stops ticking once the window closes (saves
  // CPU on a 100-row page).
  useEffect(() => {
    if (!undo) return;
    const elapsed = Date.now() - new Date(log.created_at).getTime();
    if (elapsed >= UNDO_WINDOW_MS) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [undo, log.created_at]);

  if (!undo) return <span className="text-muted-foreground">—</span>;
  if (reverted) return <span className="text-emerald-600">Reverted</span>;

  const elapsed = now - new Date(log.created_at).getTime();
  const expired = elapsed >= UNDO_WINDOW_MS;
  const secondsLeft = Math.max(0, Math.ceil((UNDO_WINDOW_MS - elapsed) / 1000));

  const doUndo = async () => {
    if (expired || busy) return;
    setBusy(true);
    try {
      const patch: Record<string, unknown> = {
        [undo.column]: undo.priorValue,
        updated_at: new Date().toISOString(),
      };
      const { error } = await supabase.from(undo.table).update(patch).eq('id', undo.rowId);
      if (error) {
        console.warn('[ActivityLog] undo failed', error);
        setBusy(false);
        return;
      }
      setReverted(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Button size="sm" variant="outline" disabled={expired || busy} onClick={doUndo}>
      {busy ? '…' : expired ? 'Expired' : `Undo (${secondsLeft}s)`}
    </Button>
  );
};
