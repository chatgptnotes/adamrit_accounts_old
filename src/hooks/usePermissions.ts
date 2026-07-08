/**
 * usePermissions Hook
 * Provides permission checking based on current user's role
 */

import { useAuth } from '@/contexts/AuthContext';
import { canEditMasters, canDeleteMasters, canManageUsers, canDeleteRecords, hasPermission, Permission } from '@/lib/permissions';

interface PermissionChecks {
  canEditMasters: boolean;
  canDeleteMasters: boolean;
  canManageUsers: boolean;
  canDeleteRecords: boolean;
  hasPermission: (permission: Permission) => boolean;
}

export const usePermissions = (): PermissionChecks => {
  const { user } = useAuth();
  const userRole = user?.role;
  const normalizedRole = (userRole || '').toLowerCase().trim();
  const isSuperAdmin = normalizedRole === 'superadmin' || normalizedRole === 'super_admin';

  return {
    // SuperAdmin always has all permissions
    canEditMasters: isSuperAdmin || canEditMasters(normalizedRole as any),
    canDeleteMasters: isSuperAdmin || canDeleteMasters(normalizedRole as any),
    canManageUsers: isSuperAdmin || canManageUsers(normalizedRole as any),
    canDeleteRecords: isSuperAdmin || canDeleteRecords(normalizedRole as any),
    hasPermission: (permission: Permission) => isSuperAdmin || hasPermission(normalizedRole as any, permission),
  };
};
