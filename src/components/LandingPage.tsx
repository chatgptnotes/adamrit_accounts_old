import React from 'react';
import { Button } from '@/components/ui/button';

interface LandingPageProps {
  onGetStarted: () => void;
  onLoginClick: () => void;
}

const LandingPage = ({ onGetStarted, onLoginClick }: LandingPageProps) => {
  return (
    <div className="min-h-screen bg-white">
      {/* Navigation Bar */}
      <nav className="absolute inset-x-0 top-0 z-50 pointer-events-auto px-6 pb-6 pt-[calc(1.5rem+env(safe-area-inset-top))]">
        <div className="flex justify-between items-center">
          <div className="text-2xl font-bold text-blue-900">ADAMRIT</div>
          <Button
            type="button"
            onClick={() => window.location.href = '/login'}
            variant="outline"
            size="sm"
            className="bg-white/90 hover:bg-white border-blue-200"
          >
            Login
          </Button>
        </div>
      </nav>

      {/* Hero Section */}
      <div className="relative min-h-screen flex items-center">
        {/* Hero Image */}
        <div className="absolute inset-0 z-0">
          <img 
            src="/hero-image.png" 
            alt="Healthcare Technology" 
            className="w-full h-full object-cover"
          />
          <div className="absolute inset-0 bg-blue-900/20"></div>
        </div>

        {/* Content Overlay */}
        <div className="relative z-10 container mx-auto px-6 py-20">
          <div className="max-w-4xl">
            <h1 className="text-5xl md:text-7xl font-bold text-white mb-6 leading-tight">
              ADAMRIT
            </h1>
            <p className="text-2xl md:text-3xl text-blue-100 mb-8 font-light">
              Where Healthcare Flows Seamlessly – Smart Systems. Healthier Outcomes
            </p>
            <p className="text-lg md:text-xl text-white/90 mb-12 max-w-3xl leading-relaxed">
              Transform your healthcare operations with our comprehensive management platform. 
              Streamline patient care, optimize workflows, and achieve better health outcomes 
              through intelligent automation and data-driven insights.
            </p>
            
          </div>
        </div>
      </div>

      {/* Features Section */}
      <div className="py-20 bg-gray-50">
        <div className="container mx-auto px-6">
          <div className="text-center mb-16">
            <h2 className="text-4xl font-bold text-gray-900 mb-4">
              Multi-Hospital Healthcare Management
            </h2>
            <p className="text-xl text-gray-600 max-w-3xl mx-auto">
              Supporting Hope Multi-Specialty Hospital and Ayushman Hospital with unified management solutions
            </p>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <div className="bg-white p-8 rounded-xl shadow-lg hover:shadow-xl transition-shadow">
              <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center mb-6">
                <svg className="w-6 h-6 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              </div>
              <h3 className="text-xl font-semibold text-gray-900 mb-4">Patient Management</h3>
              <p className="text-gray-600 leading-relaxed">
                Comprehensive patient records, visit tracking, and care coordination for optimal health outcomes
              </p>
            </div>

            <div className="bg-white p-8 rounded-xl shadow-lg hover:shadow-xl transition-shadow">
              <div className="w-12 h-12 bg-green-100 rounded-lg flex items-center justify-center mb-6">
                <svg className="w-6 h-6 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
              </div>
              <h3 className="text-xl font-semibold text-gray-900 mb-4">Clinical Workflows</h3>
              <p className="text-gray-600 leading-relaxed">
                Streamlined processes for healthcare delivery, from admission to discharge and beyond
              </p>
            </div>

            <div className="bg-white p-8 rounded-xl shadow-lg hover:shadow-xl transition-shadow">
              <div className="w-12 h-12 bg-purple-100 rounded-lg flex items-center justify-center mb-6">
                <svg className="w-6 h-6 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                </svg>
              </div>
              <h3 className="text-xl font-semibold text-gray-900 mb-4">Analytics & Reporting</h3>
              <p className="text-gray-600 leading-relaxed">
                Data-driven insights and comprehensive reporting for informed decision-making
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Doctor Testimonial Section */}
      <div className="py-20 bg-white">
        <div className="container mx-auto px-6">
          <div className="flex flex-col lg:flex-row items-center gap-12">
            {/* Doctor Image */}
            <div className="lg:w-1/2">
              <div className="relative">
                <img 
                  src="/doctor-image.jpg" 
                  alt="Healthcare Professional" 
                  className="w-full max-w-md mx-auto rounded-2xl shadow-2xl"
                />
                <div className="absolute -bottom-6 -right-6 bg-blue-600 text-white p-4 rounded-xl shadow-lg">
                  <div className="text-center">
                    <div className="text-2xl font-bold">500+</div>
                    <div className="text-sm">Patients Served</div>
                  </div>
                </div>
              </div>
            </div>

            {/* Content */}
            <div className="lg:w-1/2">
              <div className="max-w-xl">
                <h2 className="text-4xl font-bold text-gray-900 mb-6">
                  Trusted by Healthcare Professionals
                </h2>
                <blockquote className="text-xl text-gray-700 mb-8 italic leading-relaxed">
                  "ADAMRIT has revolutionized how we manage patient care. The seamless integration 
                  of clinical workflows and intelligent analytics has significantly improved our 
                  efficiency and patient outcomes."
                </blockquote>
                <div className="border-l-4 border-blue-600 pl-6">
                  <div className="font-semibold text-gray-900 text-lg">Dr. Sarah Johnson</div>
                  <div className="text-blue-600 font-medium">Chief Medical Officer</div>
                  <div className="text-gray-600">ESIC Medical Center</div>
                </div>
                
                {/* Key Benefits */}
                <div className="mt-8 grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="flex items-center">
                    <div className="w-2 h-2 bg-blue-600 rounded-full mr-3"></div>
                    <span className="text-gray-700">Reduced paperwork by 80%</span>
                  </div>
                  <div className="flex items-center">
                    <div className="w-2 h-2 bg-blue-600 rounded-full mr-3"></div>
                    <span className="text-gray-700">Faster patient processing</span>
                  </div>
                  <div className="flex items-center">
                    <div className="w-2 h-2 bg-blue-600 rounded-full mr-3"></div>
                    <span className="text-gray-700">Improved care coordination</span>
                  </div>
                  <div className="flex items-center">
                    <div className="w-2 h-2 bg-blue-600 rounded-full mr-3"></div>
                    <span className="text-gray-700">Better health outcomes</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default LandingPage;
