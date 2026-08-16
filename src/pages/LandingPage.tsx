import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useEffect } from 'react';

const LandingPage = () => {
  const { isAuthenticated } = useAuth();
  const navigate = useNavigate();

  // Signed-in staff land on the dashboard rather than the sales page — but
  // that made the public site impossible to look at without logging out, which
  // is exactly what somebody checking the features list wants to do. An
  // explicit request for the public page is honoured: /?public=1, or any link
  // into a section such as /#features.
  const wantsPublicPage =
    typeof window !== 'undefined' &&
    (new URLSearchParams(window.location.search).has('public') || Boolean(window.location.hash));

  useEffect(() => {
    if (isAuthenticated && !wantsPublicPage) {
      navigate('/dashboard');
    }
  }, [isAuthenticated, navigate, wantsPublicPage]);

  return (
    <div className="min-h-screen bg-white">
      {/* Navigation */}
      <nav className="bg-white shadow-sm border-b sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex justify-between items-center h-16">
          <div className="flex items-center gap-2">
            <img src="/favicon.ico" alt="Adamrit" className="h-8 w-8" />
            <span className="text-xl font-bold text-blue-700">Adamrit HMS</span>
          </div>
          <div className="flex gap-3">
            <a href="#features" className="text-gray-600 hover:text-blue-600 px-3 py-2 text-sm font-medium hidden sm:block">Features</a>
            <a href="#pricing" className="text-gray-600 hover:text-blue-600 px-3 py-2 text-sm font-medium hidden sm:block">Pricing</a>
            <a href="#testimonials" className="text-gray-600 hover:text-blue-600 px-3 py-2 text-sm font-medium hidden sm:block">Testimonials</a>
            <a href="/login" className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition">Login</a>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="bg-gradient-to-br from-blue-50 via-white to-indigo-50 py-20 px-4">
        <div className="max-w-7xl mx-auto text-center">
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold text-gray-900 leading-tight">
            Adamrit — Complete<br />
            <span className="text-blue-600">Hospital Management System</span>
          </h1>
          <p className="mt-6 text-lg sm:text-xl text-gray-600 max-w-3xl mx-auto">
            India's trusted HMS software for hospitals. Manage Lab, Radiology, Pharmacy, Billing, IPD, OPD, 
            ESIC, CGHS, Accounting &amp; more — all in one NABH-compliant platform.
          </p>
          <div className="mt-8 flex flex-col sm:flex-row gap-4 justify-center">
            <a href="#contact" className="bg-blue-600 text-white px-8 py-4 rounded-xl text-lg font-semibold hover:bg-blue-700 transition shadow-lg">
              📞 Book a Demo
            </a>
            <a href="#features" className="border-2 border-blue-600 text-blue-600 px-8 py-4 rounded-xl text-lg font-semibold hover:bg-blue-50 transition">
              Explore Features
            </a>
          </div>
          <p className="mt-4 text-sm text-gray-500">Trusted by Hope Hospital &amp; Ayushman Hospital, Nagpur</p>
        </div>
      </section>

      {/* Features Section */}
      <section id="features" className="py-20 px-4 bg-white">
        <div className="max-w-7xl mx-auto">
          <h2 className="text-3xl sm:text-4xl font-bold text-center text-gray-900 mb-4">
            All-in-One Hospital ERP India
          </h2>
          <p className="text-center text-gray-500 mb-12 max-w-2xl mx-auto">
            Comprehensive HMS software covering every department — from patient registration to final billing.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {[
              { icon: '🏥', title: 'IPD Management', desc: 'Inpatient admissions, bed management, ward transfers & discharge summaries' },
              { icon: '🩺', title: 'OPD Management', desc: 'Outpatient registration, appointments, consultations & follow-ups' },
              { icon: '🔬', title: 'Lab / Pathology', desc: 'Sample collection, test processing, report generation & integration' },
              { icon: '📡', title: 'Radiology', desc: 'Imaging orders, PACS integration, reports & radiology billing' },
              { icon: '💊', title: 'Pharmacy', desc: 'Inventory management, prescriptions, dispensing & purchase orders' },
              { icon: '💰', title: 'Billing & Accounting', desc: 'Patient billing, insurance claims, cash book & financial reports' },
              { icon: '🏛️', title: 'ESIC Billing', desc: 'Complete ESIC claim management, patient mapping & submission tracking' },
              { icon: '🏥', title: 'CGHS Module', desc: 'CGHS surgery management, rate cards & claim processing' },
              { icon: '🔪', title: 'OT Notes', desc: 'Operation theatre scheduling, surgical notes & anaesthesia records' },
              { icon: '📋', title: 'Discharge Summary', desc: 'Auto-generated discharge summaries with diagnosis & treatment details' },
              { icon: '📊', title: 'MIS Reports', desc: 'Revenue reports, occupancy stats, department-wise analytics' },
              { icon: '✅', title: 'NABH Compliant', desc: 'Built to meet NABH accreditation standards for quality healthcare' },
            ].map((f, i) => (
              <div key={i} className="bg-gray-50 rounded-xl p-6 hover:shadow-lg transition border border-gray-100">
                <div className="text-3xl mb-3">{f.icon}</div>
                <h3 className="font-semibold text-gray-900 text-lg mb-2">{f.title}</h3>
                <p className="text-gray-500 text-sm">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing Section */}
      <section id="pricing" className="py-20 px-4 bg-blue-50">
        <div className="max-w-4xl mx-auto text-center">
          <h2 className="text-3xl sm:text-4xl font-bold text-gray-900 mb-4">Simple, Transparent Pricing</h2>
          <p className="text-gray-600 mb-10">Flexible plans for hospitals of all sizes. Contact us for a customized quote.</p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {[
              { name: 'Starter', desc: 'For small clinics', features: ['OPD & IPD', 'Billing', 'Lab Module', 'Up to 5 users'] },
              { name: 'Professional', desc: 'For mid-size hospitals', features: ['All Starter features', 'Pharmacy & Radiology', 'ESIC & CGHS', 'Unlimited users', 'MIS Reports'], highlight: true },
              { name: 'Enterprise', desc: 'For large hospitals', features: ['All Professional features', 'Multi-branch support', 'Custom integrations', 'Dedicated support', 'NABH compliance'] },
            ].map((p, i) => (
              <div key={i} className={`rounded-2xl p-8 ${p.highlight ? 'bg-blue-600 text-white shadow-xl scale-105' : 'bg-white shadow-md'}`}>
                <h3 className="text-xl font-bold mb-1">{p.name}</h3>
                <p className={`text-sm mb-6 ${p.highlight ? 'text-blue-100' : 'text-gray-500'}`}>{p.desc}</p>
                <ul className="text-left space-y-2 mb-6">
                  {p.features.map((f, j) => (
                    <li key={j} className="flex items-center gap-2 text-sm">
                      <span>{p.highlight ? '✅' : '✓'}</span> {f}
                    </li>
                  ))}
                </ul>
                <a href="#contact" className={`block w-full py-3 rounded-lg font-semibold text-center ${p.highlight ? 'bg-white text-blue-600 hover:bg-blue-50' : 'bg-blue-600 text-white hover:bg-blue-700'} transition`}>
                  Contact for Demo
                </a>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Testimonials */}
      <section id="testimonials" className="py-20 px-4 bg-white">
        <div className="max-w-5xl mx-auto text-center">
          <h2 className="text-3xl sm:text-4xl font-bold text-gray-900 mb-12">Trusted by Leading Hospitals</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            {[
              { name: 'Hope Hospital, Nagpur', quote: 'Adamrit HMS has transformed our hospital operations. Billing, lab, and pharmacy are now seamlessly integrated.' },
              { name: 'Ayushman Hospital, Nagpur', quote: 'The ESIC billing module alone saved us hours of manual work every week. Highly recommended for any hospital.' },
            ].map((t, i) => (
              <div key={i} className="bg-gray-50 rounded-xl p-8 text-left border border-gray-100">
                <p className="text-gray-600 italic mb-4">"{t.quote}"</p>
                <p className="font-semibold text-gray-900">— {t.name}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Contact / CTA */}
      <section id="contact" className="py-20 px-4 bg-gradient-to-br from-blue-600 to-indigo-700 text-white">
        <div className="max-w-3xl mx-auto text-center">
          <h2 className="text-3xl sm:text-4xl font-bold mb-4">Ready to Modernize Your Hospital?</h2>
          <p className="text-blue-100 text-lg mb-8">
            Book a free demo and see how Adamrit HMS can streamline your hospital management.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <a href="tel:+919999999999" className="bg-white text-blue-600 px-8 py-4 rounded-xl text-lg font-semibold hover:bg-blue-50 transition">
              📞 Call Now
            </a>
            <a href="mailto:info@adamrit.com" className="border-2 border-white text-white px-8 py-4 rounded-xl text-lg font-semibold hover:bg-white/10 transition">
              ✉️ Email Us
            </a>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-gray-900 text-gray-400 py-12 px-4">
        <div className="max-w-7xl mx-auto text-center">
          <p className="font-semibold text-white text-lg mb-2">Adamrit HMS</p>
          <p className="text-sm mb-4">Complete Hospital Management System — Lab, Radiology, Pharmacy, Billing, IPD, OPD, ESIC, CGHS</p>
          <p className="text-sm">Keywords: hospital management system India | HMS software | ESIC billing software | NABH compliant HMS | hospital ERP India</p>
          <p className="text-xs mt-6">&copy; {new Date().getFullYear()} Adamrit. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
};

export default LandingPage;
