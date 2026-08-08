import React from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { HOSPITAL_CONFIGS, HospitalType } from '@/types/hospital';

interface HospitalSelectionProps {
  onHospitalSelect: (hospitalType: HospitalType) => void;
  onBackToHome?: () => void;
}

const HospitalSelection = ({ onHospitalSelect, onBackToHome }: HospitalSelectionProps) => {
  const hospitals = Object.values(HOSPITAL_CONFIGS);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100">
      {onBackToHome && (
        <Button
          onClick={onBackToHome}
          variant="ghost"
          className="absolute top-4 left-4 text-gray-600 hover:text-gray-900"
        >
          ← Back to Home
        </Button>
      )}
      
      <div className="w-full max-w-6xl mx-auto p-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-16">
          {hospitals.map((hospital) => (
            <Card 
              key={hospital.id}
              className="cursor-pointer hover:shadow-xl transition-all duration-300 hover:scale-105 border-2 hover:border-gray-300"
              onClick={() => onHospitalSelect(hospital.id)}
              style={{ 
                '--hospital-color': hospital.primaryColor,
                borderColor: 'var(--hospital-color)'
              } as React.CSSProperties}
            >
              <CardHeader className="text-center pb-4">
                <div className="w-20 h-20 mx-auto mb-4 rounded-full flex items-center justify-center text-white text-2xl font-bold"
                     style={{ backgroundColor: hospital.primaryColor }}>
                  {hospital.name.charAt(0)}
                </div>
                <CardTitle className="text-2xl font-bold" style={{ color: hospital.primaryColor }}>
                  {hospital.fullName}
                </CardTitle>
                <CardDescription className="text-gray-600 font-medium">
                  {hospital.name} Hospital Management
                </CardDescription>
              </CardHeader>
              
              <CardContent className="space-y-4">
                <p className="text-center text-gray-700 leading-relaxed">
                  {hospital.description}
                </p>
                
                <div className="text-center">
                  <p className="text-sm font-semibold" style={{ color: hospital.primaryColor }}>
                    "{hospital.tagline}"
                  </p>
                </div>

                {/* Feature highlights */}
                <div className="space-y-2">
                  <p className="text-xs text-gray-500 uppercase tracking-wide">Available Services</p>
                  <div className="flex flex-wrap gap-1">
                    {Object.entries(hospital.features)
                      .filter(([, enabled]) => enabled)
                      .slice(0, 4)
                      .map(([feature]) => (
                        <span 
                          key={feature}
                          className="px-2 py-1 text-xs rounded-full text-white"
                          style={{ backgroundColor: hospital.secondaryColor }}
                        >
                          {feature.replace(/^has/, '').replace(/([A-Z])/g, ' $1').trim()}
                        </span>
                      ))
                    }
                  </div>
                </div>

                <Button 
                  className="w-full mt-4 text-white hover:opacity-90 transition-opacity"
                  style={{ backgroundColor: hospital.primaryColor }}
                  onClick={(e) => {
                    e.stopPropagation();
                    onHospitalSelect(hospital.id);
                  }}
                >
                  Access {hospital.fullName}
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="mt-10 text-center space-y-4">
          <div className="flex items-center justify-center gap-4">
            <Button
              variant="outline"
              onClick={() => window.location.href = '/login'}
              className="px-6 py-2 border-green-300 text-green-600 hover:bg-green-50"
            >
              🔑 Database Login
            </Button>
          </div>

          <p className="text-gray-500 text-sm">
            Accounts are created by your administrator in User Management.
            Need help selecting your hospital? Contact your system administrator.
          </p>
        </div>
      </div>
    </div>
  );
};

export default HospitalSelection;