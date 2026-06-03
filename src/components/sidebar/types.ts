
import { LucideIcon } from 'lucide-react';

export interface MenuItem {
  title: string;
  icon: LucideIcon;
  description: string;
  route: string;
  count: number;
  section?: string;
  group?: string;
}

export interface AppSidebarProps {
  diagnosesCount?: number;
  patientsCount?: number;
  usersCount?: number;
  complicationsCount?: number;
  cghsSurgeryCount?: number;
  labCount?: number;
  radiologyCount?: number;
  medicationCount?: number;
  esicSurgeonsCount?: number;
  refereesCount?: number;
  hopeSurgeonsCount?: number;
  hopeConsultantsCount?: number;
  hopeAnaesthetistsCount?: number;
  ayushmanSurgeonsCount?: number;
  ayushmanConsultantsCount?: number;
  ayushmanAnaesthetistsCount?: number;
  pendingPrescriptionsCount?: number;
}
