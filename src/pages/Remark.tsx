import React from 'react';
import { MessageSquare } from 'lucide-react';

const Remark = () => {
  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex items-center gap-3">
        <MessageSquare className="h-6 w-6 text-primary" />
        <h1 className="text-2xl font-bold">Remark</h1>
      </div>
      <p className="text-muted-foreground">No remarks yet.</p>
    </div>
  );
};

export default Remark;
