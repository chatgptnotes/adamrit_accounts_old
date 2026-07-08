
import { useMemo } from 'react';
import { menuItems } from './menuItems';
import { AppSidebarProps, MenuItem } from './types';
import { useAuth } from '@/contexts/AuthContext';
import { usePermissions } from '@/hooks/usePermissions';
import { isFeatureEnabled } from '@/types/hospital';
import { useMasterCounts } from '@/hooks/useMasterCounts';
import { groupForTitle } from './sidebarGroups';
import { useAccountingRights } from '@/components/accounting/tally/rights';

const ADMIN_ROLES = ['superadmin', 'super_admin', 'admin'];

// Tab title -> roles allowed to SEE the count badge on that tab.
// Tab *visibility* is already handled by the filter below; this only controls
// whether the number shows, so non-relevant roles don't see noisy counts.
const BADGE_ROLE_MAP: Record<string, string[]> = {
  'Patient Dashboard': [...ADMIN_ROLES, 'doctor', 'consultant', 'nurse', 'receptionist', 'reception', 'front_office'],
  'Patients': [...ADMIN_ROLES, 'doctor', 'consultant', 'nurse', 'receptionist', 'reception', 'front_office'],
  'Pharmacy': [...ADMIN_ROLES, 'pharmacy', 'pharmacist'],
  'Lab': [...ADMIN_ROLES, 'lab', 'lab_technician'],
  'Radiology': [...ADMIN_ROLES, 'radiology', 'radiology_tech'],
  'Lab Master': ADMIN_ROLES,
  'Radiology Master': ADMIN_ROLES,
  'Surgery': ADMIN_ROLES,
  'Diagnoses': ADMIN_ROLES,
  'Complications': ADMIN_ROLES,
  'Medications': ADMIN_ROLES,
  'Referees': ADMIN_ROLES,
  'Users': ADMIN_ROLES,
  'Hope Surgeons': ADMIN_ROLES,
  'Hope Consultants': ADMIN_ROLES,
  'Hope Anaesthetists': ADMIN_ROLES,
  'Ayushman Surgeons': ADMIN_ROLES,
  'Ayushman Consultants': ADMIN_ROLES,
  'Ayushman Anaesthetists': ADMIN_ROLES,
};

export const useMenuItems = (props: AppSidebarProps): { mainItems: MenuItem[]; masterItems: MenuItem[] } => {
  const { hospitalType, user } = useAuth();
  const { canManageUsers } = usePermissions();
  const { canAlter: canAccessAccounting } = useAccountingRights();
  const masterCounts = useMasterCounts(!!user);
  const {
    diagnosesCount = 0,
    patientsCount = 0,
    usersCount = 0,
    complicationsCount = 0,
    cghsSurgeryCount = 0,
    labCount = 0,
    radiologyCount = 0,
    medicationCount = 0,
    refereesCount = 0,
    hopeSurgeonsCount = 0,
    hopeConsultantsCount = 0,
    hopeAnaesthetistsCount = 0,
    ayushmanSurgeonsCount = 0,
    ayushmanConsultantsCount = 0,
    ayushmanAnaesthetistsCount = 0,
    pendingPrescriptionsCount = 0,
  } = props;

  return useMemo(() => {
    const userRole = (user?.role || '').toLowerCase().trim();
    const isSuperAdmin = userRole === 'superadmin' || userRole === 'super_admin';

    const filtered = menuItems
      .filter(item => {
        // Hide Users tab for non-superadmins
        if (item.title === "Users" || item.url === "/users") {
          if (!isSuperAdmin) {
            return false;
          }
        }

        // Backward compatibility: preserve admin-only behavior where required
        if (item.title === "Users" && !canManageUsers && !isSuperAdmin) {
          return false;
        }

        // Hide User Management tab for non-superadmins only
        if (item.title === "User Management" || item.url === "/user-management") {
          if (!isSuperAdmin) {
            return false;
          }
        }

        if (item.title === "Payment Allocation" && !canAccessAccounting) {
          return false;
        }

        // Hide Director Dashboard for non-authorized users
        if (item.title === "Director Dashboard") {
          const DIRECTOR_EMAILS = ['cmd@hopehospital.com', 'finance@hopehospital.com'];
          const DIRECTOR_ROLES = ['superadmin', 'super_admin'];
          const userEmail = user?.email?.toLowerCase() || '';
          const userRole = user?.role || '';
          if (!DIRECTOR_EMAILS.includes(userEmail) && !DIRECTOR_ROLES.includes(userRole)) {
            return false;
          }
        }

        // Hide Lab Master & Radiology Master for all users except specific admins
        if (item.title === "Lab Master" || item.title === "Radiology Master" || item.title === "Surgery") {
          const MASTER_ADMIN_EMAILS = [
            'admin@hopehospital.com',
            'admin@ayushmanhospital.com',
            'admin@test.com',
          ];
          const userEmail = user?.email?.toLowerCase() || '';
          const userRole = user?.role;
          // Lab Master is open to the admin role too; the other masters stay superadmin-only
          const allowedRoles = item.title === "Lab Master" ? ['superadmin', 'admin'] : ['superadmin'];
          if (!allowedRoles.includes(userRole || '') && !MASTER_ADMIN_EMAILS.includes(userEmail)) {
            return false;
          }
        }

        if (!hospitalType) return true; // Show all items if no hospital type

        // Filter menu items based on hospital features
        switch (item.title) {
          case "Pharmacy":
            return isFeatureEnabled(hospitalType, 'hasPharmacy');
          case "Lab":
          case "Lab Master":
            return isFeatureEnabled(hospitalType, 'hasLab');
          case "Radiology":
          case "Radiology Master":
            return isFeatureEnabled(hospitalType, 'hasRadiology');
          case "Accounting":
            return isFeatureEnabled(hospitalType, 'hasAccounting');
          case "Hope Surgeons":
            return isFeatureEnabled(hospitalType, 'hasHopeSurgeons');
          case "Hope Consultants":
            return isFeatureEnabled(hospitalType, 'hasHopeConsultants');
          case "Hope Anaesthetists":
            return isFeatureEnabled(hospitalType, 'hasHopeAnaesthetists');
          case "Ayushman Surgeons":
            return isFeatureEnabled(hospitalType, 'hasAyushmanSurgeons');
          case "Ayushman Consultants":
            return isFeatureEnabled(hospitalType, 'hasAyushmanConsultants');
          case "Ayushman Anaesthetists":
            return isFeatureEnabled(hospitalType, 'hasAyushmanAnaesthetists');
          case "Surgery":
            return isFeatureEnabled(hospitalType, 'hasCghsSurgery');
          default:
            return true; // Show other items by default
        }
      })
      .map(item => {
        const rawCount = item.title === "Patient Dashboard" ? patientsCount :
               item.title === "Diagnoses" ? diagnosesCount :
               item.title === "Patients" ? patientsCount :
               item.title === "Users" ? usersCount :
               item.title === "Complications" ? complicationsCount :
               item.title === "Surgery" ? cghsSurgeryCount :
               item.title === "Lab" || item.title === "Lab Master" ? labCount :
               item.title === "Radiology" || item.title === "Radiology Master" ? radiologyCount :
               item.title === "Medications" ? medicationCount :
               item.title === "Referees" ? refereesCount :
               item.title === "Hope Surgeons" ? hopeSurgeonsCount :
               item.title === "Hope Consultants" ? hopeConsultantsCount :
               item.title === "Hope Anaesthetists" ? hopeAnaesthetistsCount :
               item.title === "Ayushman Surgeons" ? ayushmanSurgeonsCount :
               item.title === "Ayushman Consultants" ? ayushmanConsultantsCount :
               item.title === "Ayushman Anaesthetists" ? ayushmanAnaesthetistsCount :
               item.title === "Pharmacy" ? pendingPrescriptionsCount : 0;

        // Masters always show their list size (the section is admin-scoped
        // already). Main tabs show a count only for roles relevant to that tab.
        // A 0 count renders no badge — see SidebarMenuItem.
        const isMaster = item.section === 'masters';
        const showBadge = (BADGE_ROLE_MAP[item.title] || []).includes(user?.role || '');
        const count = isMaster
          ? (masterCounts[item.title] ?? 0)
          : (showBadge ? rawCount : 0);

        return {
          title: item.title,
          icon: item.icon,
          description: `View ${item.title.toLowerCase()} data`,
          route: item.url,
          section: item.section || 'main' as const,
          group: groupForTitle(item.title),
          count,
        };
      });

    return {
      mainItems: filtered.filter(item => item.section !== 'masters'),
      masterItems: filtered.filter(item => item.section === 'masters'),
    };
  }, [
    hospitalType, user, canManageUsers, canAccessAccounting, masterCounts, diagnosesCount, patientsCount, usersCount, complicationsCount,
    cghsSurgeryCount, labCount, radiologyCount, medicationCount,
    refereesCount, hopeSurgeonsCount, hopeConsultantsCount, hopeAnaesthetistsCount,
    ayushmanSurgeonsCount, ayushmanConsultantsCount, ayushmanAnaesthetistsCount,
    pendingPrescriptionsCount
  ]);
};
