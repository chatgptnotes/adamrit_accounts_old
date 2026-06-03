import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import { useDepartmentActivity } from '@/hooks/useDepartmentActivity';

/**
 * CMD/Director panel: one tile per department showing whether it has entered any
 * operational data today. Green = active, red alarm = silent. Reuses the alert
 * visual language already on the Director Dashboard.
 */
export const DepartmentActivityMonitor = () => {
  const { departments, isLoading } = useDepartmentActivity();

  if (isLoading) {
    return (
      <div className="rounded-lg border p-5 text-sm text-gray-500">
        Checking department data entry for today…
      </div>
    );
  }

  if (departments.length === 0) return null;

  const silent = departments.filter(d => !d.entered);

  return (
    <div className="space-y-3">
      {silent.length > 0 ? (
        <div
          role="alert"
          className="relative rounded-lg border-2 border-red-600 bg-gradient-to-r from-red-50 to-red-100 p-4 shadow-lg animate-pulse"
        >
          <div className="flex items-center gap-3">
            <AlertTriangle className="h-8 w-8 flex-shrink-0 text-red-600" />
            <div>
              <h2 className="text-lg font-bold tracking-tight text-red-800">
                {silent.length} DEPARTMENT{silent.length === 1 ? '' : 'S'} HAVE NOT ENTERED DATA TODAY
              </h2>
              <p className="text-sm text-red-700">
                {silent.map(d => d.label).join(', ')}
              </p>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-2 rounded-lg border-2 border-emerald-500 bg-emerald-50 p-4 text-emerald-800">
          <CheckCircle2 className="h-6 w-6 flex-shrink-0" />
          <span className="font-semibold">All departments have entered data today.</span>
        </div>
      )}

      <div>
        <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-500">
          Department Data Entry — Today
        </h3>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {departments.map(d => (
            <div
              key={d.key}
              className={`flex items-center gap-3 rounded-2xl border p-3 ${
                d.entered
                  ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-700'
                  : 'border-red-500/60 bg-red-500/10 text-red-700'
              }`}
            >
              {d.entered ? (
                <CheckCircle2 className="h-5 w-5 flex-shrink-0" />
              ) : (
                <AlertTriangle className="h-5 w-5 flex-shrink-0" />
              )}
              <div className="min-w-0">
                <div className="text-[11px] font-semibold uppercase tracking-wide opacity-80">
                  {d.label}
                </div>
                <div className="mt-0.5 truncate text-sm font-bold">
                  {d.entered ? `${d.count} ${d.count === 1 ? 'entry' : 'entries'}` : 'No data entered today'}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default DepartmentActivityMonitor;
