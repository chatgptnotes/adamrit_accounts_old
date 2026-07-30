
import { useNavigate } from 'react-router-dom';

interface NavigationTabsProps {
  activeTab: string;
}

export const NavigationTabs = ({ activeTab }: NavigationTabsProps) => {
  const navigate = useNavigate();

  const handleTabClick = (tabName: string) => {
    switch (tabName) {
      case 'Dashboard':
        navigate('/dashboard');
        break;
      case 'IPD':
        navigate('/todays-ipd');
        break;
      case 'OPD':
        navigate('/todays-opd');
        break;
      case 'Patients':
        navigate('/patients');
        break;
      case 'Reports':
        navigate('/reports');
        break;
      default:
        break;
    }
  };

  // 'Doctors' and 'Settings' were listed here but had no destination — they
  // rendered as clickable tabs that did nothing. Removed until a route exists.
  const tabs = ['Dashboard', 'IPD', 'OPD', 'Patients', 'Reports'];

  return (
    <div className="flex items-center gap-6 border-b">
      {tabs.map((tab) => (
        <button
          key={tab}
          onClick={() => handleTabClick(tab)}
          className={`flex items-center gap-2 px-4 py-2 transition-colors cursor-pointer ${
            tab === activeTab
              ? 'text-primary border-b-2 border-primary font-medium'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          <span>{tab}</span>
        </button>
      ))}
    </div>
  );
};
