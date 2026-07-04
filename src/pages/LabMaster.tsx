import { Navigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import LabPanelManager from '../components/lab/LabPanelManager';

const MASTER_ADMIN_EMAILS = [
  'admin@hopehospital.com',
  'admin@ayushmanhospital.com',
  'admin@test.com',
];

const LabMaster = () => {
  const { user } = useAuth();
  const userEmail = user?.email?.toLowerCase() || '';
  const userRole = user?.role;

  if (userRole !== 'superadmin' && userRole !== 'admin' && !MASTER_ADMIN_EMAILS.includes(userEmail)) {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-6">Lab Master</h1>
      <LabPanelManager />
    </div>
  );
};

export default LabMaster;
