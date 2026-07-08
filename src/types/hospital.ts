export type HospitalType = 'hope' | 'ayushman';

export interface HospitalConfig {
  id: HospitalType;
  name: string;
  fullName: string;
  logo: string;
  favicon: string;
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  tagline: string;
  description: string;
  contactInfo: {
    phone: string;
    email: string;
    address: string;
  };
  features: {
    hasPharmacy: boolean;
    hasLab: boolean;
    hasRadiology: boolean;
    hasOperationTheatre: boolean;
    hasAccounting: boolean;
    hasHopeSurgeons: boolean;
    hasHopeConsultants: boolean;
    hasHopeAnaesthetists: boolean;
    hasAyushmanSurgeons: boolean;
    hasAyushmanConsultants: boolean;
    hasAyushmanAnaesthetists: boolean;
    hasCghsSurgery: boolean;
  };
  theme: {
    sidebarBg: string;
    headerBg: string;
    cardBg: string;
    textPrimary: string;
    textSecondary: string;
  };
}

export const HOSPITAL_CONFIGS: Record<HospitalType, HospitalConfig> = {
  hope: {
    id: 'hope',
    name: 'hope',
    fullName: 'Hope Multi-Specialty Hospital',
    logo: '/logos/hope-logo.png',
    favicon: '/favicons/hope-favicon.ico',
    primaryColor: '#059669',
    secondaryColor: '#10b981',
    accentColor: '#34d399',
    tagline: 'Where Healthcare Meets Hope',
    description: 'Advanced medical care with compassionate service',
    contactInfo: {
      phone: '+91-40-2345-6789',
      email: 'info@hopehospital.com',
      address: 'Chande Colony, Mahle Hospital, Nagpur, Maharashtra 440026'
    },
    features: {
      hasPharmacy: true,
      hasLab: true,
      hasRadiology: true,
      hasOperationTheatre: true,
      hasAccounting: true,
      hasHopeSurgeons: true,
      hasHopeConsultants: true,
      hasHopeAnaesthetists: true,
      hasAyushmanSurgeons: false,
      hasAyushmanConsultants: false,
      hasAyushmanAnaesthetists: false,
      hasCghsSurgery: true,
    },
    theme: {
      sidebarBg: '#059669',
      headerBg: '#10b981',
      cardBg: '#ffffff',
      textPrimary: '#1f2937',
      textSecondary: '#6b7280',
    },
  },
  ayushman: {
    id: 'ayushman',
    name: 'ayushman',
    fullName: 'Ayushman Hospital',
    logo: '/logos/ayushman-logo.png',
    favicon: '/favicons/ayushman-favicon.ico',
    primaryColor: '#dc2626',
    secondaryColor: '#ef4444',
    accentColor: '#f87171',
    tagline: 'Health for All, Care for Everyone',
    description: 'Universal healthcare under the Ayushman Bharat scheme',
    contactInfo: {
      phone: '+91-80-2345-6789',
      email: 'info@ayushmanhospital.gov.in',
      address: 'Ayushman Hospital, Bangalore'
    },
    features: {
      hasPharmacy: true,
      hasLab: true,
      hasRadiology: true,
      hasOperationTheatre: true,
      hasAccounting: true,
      hasHopeSurgeons: false,
      hasHopeConsultants: false,
      hasHopeAnaesthetists: false,
      hasAyushmanSurgeons: true,
      hasAyushmanConsultants: true,
      hasAyushmanAnaesthetists: true,
      hasCghsSurgery: true,
    },
    theme: {
      sidebarBg: '#dc2626',
      headerBg: '#ef4444',
      cardBg: '#ffffff',
      textPrimary: '#1f2937',
      textSecondary: '#6b7280',
    },
  },
};

export const getHospitalConfig = (hospitalType?: HospitalType): HospitalConfig => {
  return hospitalType ? HOSPITAL_CONFIGS[hospitalType] : HOSPITAL_CONFIGS.hope;
};

// Function to get hospital name by short name (for database queries)
export const getHospitalByName = (name: string): HospitalConfig | undefined => {
  return Object.values(HOSPITAL_CONFIGS).find(config => config.name === name);
};

export const isFeatureEnabled = (hospitalType: HospitalType, feature: keyof HospitalConfig['features']): boolean => {
  return HOSPITAL_CONFIGS[hospitalType].features[feature];
};
