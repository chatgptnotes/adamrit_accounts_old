import { useState } from 'react';
import { LayoutDashboard, Printer } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { BILLING_TASKS, SHIFTS, type TaskStatus } from './billingTasks';
import BillingWorkflowDiagram from './BillingWorkflowDiagram';
import BillingChatbot from './BillingChatbot';

function DashboardContent({ statuses, onChange }: {
  statuses: Record<string, TaskStatus>;
  onChange: (id: string, s: TaskStatus) => void;
}) {
  const total = BILLING_TASKS.length;
  const done = Object.values(statuses).filter(s => s === 'done').length;
  const inprog = Object.values(statuses).filter(s => s === 'inprogress').length;
  const todo = total - done - inprog;
  const pct = Math.round((done / total) * 100);

  const today = new Date().toLocaleDateString('en-IN', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-6 py-3 border-b bg-gradient-to-r from-blue-600 to-blue-500 shrink-0">
        <div className="flex items-center justify-between gap-4">
          {/* Title */}
          <div className="flex items-center gap-3">
            <div className="bg-white/20 rounded-lg p-1.5">
              <LayoutDashboard className="h-5 w-5 text-white" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white leading-tight">Billing Operations Dashboard</h2>
              <p className="text-xs text-blue-100">{today}</p>
            </div>
          </div>

          {/* Stats + progress + print */}
          <div className="flex items-center gap-5">
            <div className="flex gap-4 text-xs text-white/90">
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-white/50 inline-block" />
                {todo} to do
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-yellow-300 inline-block" />
                {inprog} in progress
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-green-300 inline-block" />
                {done} done
              </span>
            </div>
            <div className="flex items-center gap-2 min-w-32">
              <div className="flex-1 h-2 bg-white/30 rounded-full overflow-hidden">
                <div
                  className="h-full bg-green-300 rounded-full transition-all duration-500"
                  style={{ width: `${pct}%` }}
                />
              </div>
              <span className="text-xs font-bold text-white tabular-nums">{done}/{total}</span>
            </div>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-xs text-white hover:bg-white/20 hover:text-white"
              onClick={() => window.print()}
            >
              <Printer className="h-3.5 w-3.5 mr-1" /> Print
            </Button>
          </div>
        </div>
      </div>

      {/* 3-column body */}
      <div className="flex flex-1 overflow-hidden bg-slate-50">

        {/* LEFT — Task to-do list */}
        <div className="w-60 shrink-0 border-r flex flex-col overflow-hidden bg-white">
          <div className="px-3 py-2 bg-slate-100 border-b">
            <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Daily Tasks</p>
          </div>
          <div className="flex-1 overflow-y-auto">
            {SHIFTS.map(shift => {
              const tasks = BILLING_TASKS.filter(t => t.shift === shift.id);
              const shiftDone = tasks.filter(t => (statuses[t.id] ?? 'todo') === 'done').length;
              return (
                <div key={shift.id}>
                  <div className={`px-3 py-1.5 flex items-center justify-between sticky top-0 z-10 ${shift.headerColor} border-b`}>
                    <span className="text-xs font-bold">{shift.label}</span>
                    <span className={`text-xs font-medium px-1.5 py-0.5 rounded-full ${shiftDone === tasks.length ? 'bg-green-200 text-green-800' : 'bg-white/60 text-slate-600'}`}>
                      {shiftDone}/{tasks.length}
                    </span>
                  </div>
                  {tasks.map(task => {
                    const st = statuses[task.id] ?? 'todo';
                    const rowBg = st === 'done' ? 'bg-green-50' : st === 'inprogress' ? 'bg-yellow-50' : 'bg-white';
                    const dot = st === 'done' ? 'bg-green-500' : st === 'inprogress' ? 'bg-yellow-400' : 'bg-slate-300';
                    return (
                      <div key={task.id} className={`flex items-center gap-2 px-3 py-2 border-b ${rowBg} hover:brightness-[0.97] transition-all`}>
                        <span className={`h-2 w-2 rounded-full shrink-0 mt-0.5 ${dot}`} />
                        <span className="text-sm leading-none shrink-0">{task.emoji}</span>
                        <div className="flex-1 min-w-0">
                          <div className={`text-xs font-semibold truncate ${st === 'done' ? 'line-through text-slate-400' : 'text-slate-800'}`}>
                            {task.title}
                          </div>
                          <div className="text-xs text-muted-foreground truncate">{task.desc}</div>
                        </div>
                        <select
                          value={st}
                          onChange={e => onChange(task.id, e.target.value as TaskStatus)}
                          className="text-xs border rounded px-1 py-0.5 bg-white cursor-pointer shrink-0 focus:outline-none focus:ring-1 focus:ring-blue-300"
                        >
                          <option value="todo">To Do</option>
                          <option value="inprogress">In Progress</option>
                          <option value="done">Done</option>
                        </select>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>

        {/* MIDDLE — Billing Workflow */}
        <div className="flex-1 overflow-hidden flex flex-col">
          <div className="px-3 py-2 bg-slate-100 border-b">
            <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Billing Workflow</p>
          </div>
          <div className="flex-1 overflow-hidden">
            <BillingWorkflowDiagram />
          </div>
        </div>

        {/* RIGHT — Chatbot */}
        <div className="w-72 shrink-0 border-l flex flex-col overflow-hidden bg-white">
          <BillingChatbot />
        </div>

      </div>
    </div>
  );
}

export default function BillingDashboardModal() {
  const [open, setOpen] = useState(false);
  const [statuses, setStatuses] = useState<Record<string, TaskStatus>>({});
  const handleChange = (id: string, s: TaskStatus) =>
    setStatuses(prev => ({ ...prev, [id]: s }));

  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        <LayoutDashboard className="h-4 w-4 mr-1.5" />
        Billing Dashboard
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-[96vw] w-[96vw] h-[92vh] p-0 gap-0 flex flex-col overflow-hidden">
          <DashboardContent statuses={statuses} onChange={handleChange} />
        </DialogContent>
      </Dialog>
    </>
  );
}
