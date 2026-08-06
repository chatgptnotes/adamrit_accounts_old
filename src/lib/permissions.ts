/**
 * Permission System
 * Defines role-based permissions for the hospital management system
 */

export type UserRole = 'superadmin' | 'super_admin' | 'ca' | 'admin' | 'doctor' | 'nurse' | 'user' | 'marketing_manager';

export enum Permission {
  // Master Data Permissions
  EDIT_MASTERS = 'edit:masters',
  DELETE_MASTERS = 'delete:masters',
  VIEW_MASTERS = 'view:masters',

  // User Management Permissions
  MANAGE_USERS = 'manage:users',
  VIEW_USERS = 'view:users',

  // Record Permissions
  DELETE_RECORDS = 'delete:records',
  EDIT_RECORDS = 'edit:records',
  CREATE_RECORDS = 'create:records',
  VIEW_RECORDS = 'view:records',
}

/**
 * Role-based permission mapping
 * Defines which permissions each role has
 */
const rolePermissions: Record<UserRole, Permission[]> = {
  superadmin: [
    // SuperAdmin has ALL permissions - highest level access
    Permission.EDIT_MASTERS,
    Permission.DELETE_MASTERS,
    Permission.VIEW_MASTERS,
    Permission.MANAGE_USERS,
    Permission.VIEW_USERS,
    Permission.DELETE_RECORDS,
    Permission.EDIT_RECORDS,
    Permission.CREATE_RECORDS,
    Permission.VIEW_RECORDS,
  ],
  super_admin: [
    // SuperAdmin (snake_case) has ALL permissions - highest level access
    Permission.EDIT_MASTERS,
    Permission.DELETE_MASTERS,
    Permission.VIEW_MASTERS,
    Permission.MANAGE_USERS,
    Permission.VIEW_USERS,
    Permission.DELETE_RECORDS,
    Permission.EDIT_RECORDS,
    Permission.CREATE_RECORDS,
    Permission.VIEW_RECORDS,
  ],

  ca: [
    // Chartered Accountants have the same full control as SuperAdmin.
    Permission.EDIT_MASTERS,
    Permission.DELETE_MASTERS,
    Permission.VIEW_MASTERS,
    Permission.MANAGE_USERS,
    Permission.VIEW_USERS,
    Permission.DELETE_RECORDS,
    Permission.EDIT_RECORDS,
    Permission.CREATE_RECORDS,
    Permission.VIEW_RECORDS,
  ],

  admin: [
    // Admin has ALL permissions
    Permission.EDIT_MASTERS,
    Permission.DELETE_MASTERS,
    Permission.VIEW_MASTERS,
    Permission.MANAGE_USERS,
    Permission.VIEW_USERS,
    Permission.DELETE_RECORDS,
    Permission.EDIT_RECORDS,
    Permission.CREATE_RECORDS,
    Permission.VIEW_RECORDS,
  ],

  doctor: [
    // Doctors can manage records but NOT masters or users
    Permission.VIEW_MASTERS,
    Permission.CREATE_RECORDS,
    Permission.EDIT_RECORDS,
    Permission.VIEW_RECORDS,
  ],

  nurse: [
    // Nurses have similar access to doctors
    Permission.VIEW_MASTERS,
    Permission.CREATE_RECORDS,
    Permission.EDIT_RECORDS,
    Permission.VIEW_RECORDS,
  ],

  user: [
    // Users have read-only access to masters, can manage records but NOT delete
    Permission.VIEW_MASTERS,
    Permission.CREATE_RECORDS,
    Permission.EDIT_RECORDS,
    Permission.VIEW_RECORDS,
  ],

  marketing_manager: [
    // Marketing managers have same permissions as user + can edit/delete masters (referees)
    Permission.VIEW_MASTERS,
    Permission.CREATE_RECORDS,
    Permission.EDIT_RECORDS,
    Permission.VIEW_RECORDS,
    Permission.EDIT_MASTERS,
    Permission.DELETE_MASTERS,
  ],
};

/**
 * Check if a role has a specific permission
 */
export const hasPermission = (role: UserRole | undefined, permission: Permission): boolean => {
  if (!role) return false;
  return rolePermissions[role]?.includes(permission) ?? false;
};

/**
 * Check if a role can edit master data
 */
export const canEditMasters = (role: UserRole | undefined): boolean => {
  return hasPermission(role, Permission.EDIT_MASTERS);
};

/**
 * Check if a role can delete master data
 */
export const canDeleteMasters = (role: UserRole | undefined): boolean => {
  return hasPermission(role, Permission.DELETE_MASTERS);
};

/**
 * Check if a role can manage users
 */
export const canManageUsers = (role: UserRole | undefined): boolean => {
  return hasPermission(role, Permission.MANAGE_USERS);
};

/**
 * Check if a role can delete records
 */
export const canDeleteRecords = (role: UserRole | undefined): boolean => {
  return hasPermission(role, Permission.DELETE_RECORDS);
};

/**
 * Get all permissions for a role
 */
export const getRolePermissions = (role: UserRole): Permission[] => {
  return rolePermissions[role] || [];
};
