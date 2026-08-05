import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getSessionUser, serviceClient } from './_auth.js';

type HrRole = 'superadmin' | 'super_admin';

const text = (value: unknown) => typeof value === 'string' ? value.trim() : '';
const isMasterRole = (role: string): role is HrRole =>
  ['superadmin', 'super_admin'].includes(role);

const sendError = (res: VercelResponse, status: number, error: string) =>
  res.status(status).json({ ok: false, error });

async function getIdentity(sb: any, sessionUser: ReturnType<typeof getSessionUser>) {
  const { data, error } = await sb
    .from('User')
    .select('id,email,role,employee_id,hr_pulse_can_view_all')
    .eq('id', sessionUser?.id)
    .maybeSingle();
  if (error) throw error;
  return {
    id: String(data?.id || sessionUser?.id || ''),
    email: String(data?.email || sessionUser?.email || ''),
    role: String(data?.role || sessionUser?.role || 'user'),
    employeeId: text(data?.employee_id),
    canViewAll: data?.hr_pulse_can_view_all !== false,
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  if (!serviceKey) return sendError(res, 500, 'supabase_not_configured');

  const sessionUser = getSessionUser(req, serviceKey);
  if (!sessionUser) return sendError(res, 401, 'not_authenticated');

  const sb = serviceClient(serviceKey);
  let identity;
  try {
    identity = await getIdentity(sb, sessionUser);
  } catch (error: any) {
    return sendError(res, 500, error?.message || 'identity_lookup_failed');
  }

  const masterAccess = isMasterRole(identity.role) && identity.canViewAll;
  if (!masterAccess && !identity.employeeId) {
    return sendError(res, 409, 'employee_id_not_configured');
  }

  if (req.method === 'POST') {
    const body = req.body || {};
    const startDate = text(body.start_date);
    const endDate = text(body.end_date);
    const leaveType = text(body.leave_type);
    if (!startDate || !endDate || !leaveType || endDate < startDate) {
      return sendError(res, 400, 'invalid_leave_dates_or_type');
    }

    const { data, error } = await sb.from('hr_leave_requests').insert({
      employee_id: identity.employeeId,
      employee_name: text(body.employee_name) || identity.email.split('@')[0],
      employee_email: identity.email,
      leave_type: leaveType,
      start_date: startDate,
      end_date: endDate,
      reason: text(body.reason) || null,
      status: 'pending',
    }).select('*').single();
    if (error) return sendError(res, 400, error.message);
    return res.status(201).json({ ok: true, row: data });
  }

  if (req.method === 'PATCH') {
    if (!masterAccess) return sendError(res, 403, 'hr_master_access_required');
    const id = text(req.body?.id);
    const status = text(req.body?.status);
    if (!id || !['approved', 'rejected'].includes(status)) {
      return sendError(res, 400, 'invalid_leave_review');
    }
    const { data, error } = await sb.from('hr_leave_requests').update({
      status,
      reviewed_by: identity.email,
      reviewed_at: new Date().toISOString(),
      review_note: text(req.body?.review_note) || null,
    }).eq('id', id).select('*').single();
    if (error) return sendError(res, 400, error.message);
    return res.status(200).json({ ok: true, row: data });
  }

  if (req.method !== 'GET') return sendError(res, 405, 'method_not_allowed');

  const monthStart = text(req.query.monthStart) || new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10);
  const monthEnd = text(req.query.monthEnd) || new Date().toISOString().slice(0, 10);
  const lookbackStart = text(req.query.lookbackStart) || monthStart;

  const attendanceQuery = sb.from('staff_attendance')
    .select('*')
    .gte('work_date', lookbackStart)
    .lte('work_date', monthEnd)
    .order('work_date', { ascending: false });
  const leaveQuery = sb.from('hr_leave_requests')
    .select('*')
    .order('requested_at', { ascending: false })
    .limit(200);
  const payrollQuery = sb.from('hr_payroll_slips')
    .select('*')
    .gte('payroll_month', monthStart)
    .lte('payroll_month', monthEnd)
    .order('employee_name');
  const notificationQuery = sb.from('hr_notifications')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(100);

  if (!masterAccess) {
    attendanceQuery.eq('employee_id', identity.employeeId);
    leaveQuery.eq('employee_id', identity.employeeId);
    payrollQuery.eq('employee_id', identity.employeeId);
    notificationQuery.eq('employee_id', identity.employeeId);
  }

  const [attendanceResult, staffResult, leaveResult, payrollResult, notificationResult, profileResult] = await Promise.all([
    attendanceQuery,
    masterAccess ? sb.from('staff_members').select('*').order('name') : Promise.resolve({ data: [], error: null }),
    leaveQuery,
    payrollQuery,
    notificationQuery,
    sb.from('hr_employee_profiles').select('*').eq('employee_id', identity.employeeId || '__none__').maybeSingle(),
  ]);

  const firstError = [attendanceResult, staffResult, leaveResult, payrollResult, notificationResult, profileResult]
    .find((result: any) => result?.error)?.error;
  if (firstError) return sendError(res, 500, firstError.message || 'hr_query_failed');

  return res.status(200).json({
    ok: true,
    identity: {
      employeeId: identity.employeeId,
      name: profileResult.data?.employee_name || identity.email.split('@')[0],
      email: identity.email,
      role: identity.role,
      masterAccess,
    },
    attendance: attendanceResult.data || [],
    staff: staffResult.data || [],
    leaveRequests: leaveResult.data || [],
    payrollSlips: payrollResult.data || [],
    notifications: notificationResult.data || [],
  });
}
