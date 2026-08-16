import React from 'react';
import { Button } from '@/components/ui/button';
import LandingModules from '@/components/LandingModules';
import { ArrowRight, Waves, Stethoscope, FileBarChart } from 'lucide-react';
import { FadeIn } from '@/components/ui/fade-in';

const LandingPage = () => {
  return (
    <div className="min-h-screen bg-white text-gray-800">
      {/* Navigation Bar */}
      <header className="absolute inset-x-0 top-0 z-50 px-6 py-4">
        <div className="mx-auto flex max-w-7xl items-center justify-between">
          <div className="text-2xl font-bold text-primary">ADAMRIT</div>
          <Button
            type="button"
            onClick={() => window.location.href = '/login'}
            variant="outline"
            className="rounded-full border-blue-200 bg-white/80 backdrop-blur-sm hover:bg-white"
          >
            Login
          </Button>
        </div>
      </header>

      {/* Hero Section */}
      <main>
        <div className="relative isolate overflow-hidden bg-gradient-to-br from-blue-50 via-white to-blue-100">
          <div className="relative z-10 mx-auto max-w-4xl px-6 pb-32 pt-36 sm:pt-48 lg:pt-56">
            <FadeIn>
              <div className="text-center">
                <h1 className="text-5xl font-bold tracking-tight text-primary sm:text-7xl">
                  The Operating System for Modern Healthcare
                </h1>
                <p className="mt-6 text-lg leading-8 text-gray-600 sm:text-xl">
                  A unified platform to streamline patient care, optimize clinical workflows, and drive better health outcomes.
                </p>
                <div className="mt-10 flex items-center justify-center gap-x-6">
                  <a
                    href="#modules"
                    className="inline-flex items-center gap-2 rounded-full bg-primary px-6 py-3 text-lg font-semibold text-primary-foreground shadow-lg transition-transform hover:-translate-y-0.5 hover:bg-primary/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                  >
                    Explore Modules
                    <ArrowRight className="h-5 w-5" />
                  </a>
                </div>
              </div>
            </FadeIn>
          </div>
          <div
            className="absolute left-1/2 top-0 -z-10 -translate-x-1/2 blur-3xl xl:-top-6"
            aria-hidden="true"
          >
            <div
              className="aspect-[1155/678] w-[72.1875rem] bg-gradient-to-tr from-primary to-blue-300 opacity-20"
              style={{
                clipPath:
                  'polygon(74.1% 44.1%, 100% 61.6%, 97.5% 26.9%, 85.5% 0.1%, 80.7% 2%, 72.5% 32.5%, 60.2% 62.4%, 52.4% 68.1%, 47.5% 58.3%, 45.2% 34.5%, 27.5% 76.7%, 0.1% 64.9%, 17.9% 100%, 27.6% 76.8%, 76.1% 97.7%, 74.1% 44.1%)',
              }}
            />
          </div>
        </div>

        {/* Key Features Section */}
        <div className="py-24 sm:py-32 bg-gray-50">
          <div className="mx-auto max-w-7xl px-6 lg:px-8">
            <FadeIn>
              <div className="mx-auto max-w-2xl lg:text-center">
                <h2 className="text-base font-semibold leading-7 text-primary">Unified & Efficient</h2>
                <p className="mt-2 text-3xl font-bold tracking-tight text-gray-900 sm:text-4xl">
                  Everything you need to run a hospital
                </p>
                <p className="mt-6 text-lg leading-8 text-gray-600">
                  From patient registration to financial accounting, Adamrit provides a single source of truth for your entire operation.
                </p>
              </div>
            </FadeIn>
            <div className="mx-auto mt-16 max-w-2xl sm:mt-20 lg:mt-24 lg:max-w-none">
              <dl className="grid max-w-xl grid-cols-1 gap-x-8 gap-y-16 lg:max-w-none lg:grid-cols-3">
                <FadeIn delay={200}>
                  <div className="flex flex-col">
                    <dt className="flex items-center gap-x-3 text-base font-semibold leading-7 text-gray-900">
                      <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary">
                        <Stethoscope className="h-6 w-6 text-white" />
                      </div>
                      Comprehensive Clinical Management
                    </dt>
                    <dd className="mt-4 flex flex-auto flex-col text-base leading-7 text-gray-600">
                      <p className="flex-auto">
                        Track the complete patient journey with tools for notes, medication rounds, OT scheduling, and bed management. Ensure quality care at every step.
                      </p>
                    </dd>
                  </div>
                </FadeIn>
                <FadeIn delay={400}>
                  <div className="flex flex-col">
                    <dt className="flex items-center gap-x-3 text-base font-semibold leading-7 text-gray-900">
                      <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary">
                        <FileBarChart className="h-6 w-6 text-white" />
                      </div>
                      Streamlined Financial Operations
                    </dt>
                    <dd className="mt-4 flex flex-auto flex-col text-base leading-7 text-gray-600">
                      <p className="flex-auto">
                        Handle everything from patient billing and panel payments to pharmacy sales and expense tracking. Full Tally-style accounting included.
                      </p>
                    </dd>
                  </div>
                </FadeIn>
                <FadeIn delay={600}>
                  <div className="flex flex-col">
                    <dt className="flex items-center gap-x-3 text-base font-semibold leading-7 text-gray-900">
                      <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary">
                        <Waves className="h-6 w-6 text-white" />
                      </div>
                      Integrated Departmental Workflows
                    </dt>
                    <dd className="mt-4 flex flex-auto flex-col text-base leading-7 text-gray-600">
                      <p className="flex-auto">
                        Connect your pharmacy, diagnostics, inventory, and administrative tasks in one cohesive system, reducing errors and improving efficiency.
                      </p>
                    </dd>
                  </div>
                </FadeIn>
              </dl>
            </div>
          </div>
        </div>

        {/* Modules Section */}
        <FadeIn>
          <LandingModules />
        </FadeIn>

      </main>
    </div>
  );
};

export default LandingPage;
