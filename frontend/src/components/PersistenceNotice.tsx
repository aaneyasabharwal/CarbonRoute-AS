/**
 * P22: tells administrators honestly whether this server keeps their changes. Read from
 * /api/health; nothing is shown while it loads or when storage is durable.
 */
import React, { useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { api } from '../services/api';
import type { PersistenceStatus } from '../types';

export const PersistenceNotice: React.FC = () => {
  const [status, setStatus] = useState<PersistenceStatus | null>(null);
  useEffect(() => {
    let live = true;
    api.getPersistenceStatus().then((r) => {
      if (live && r.success && r.data) setStatus(r.data);
    });
    return () => {
      live = false;
    };
  }, []);
  if (!status || status.durable) return null;
  return (
    <div role="note" data-testid="persistence-notice" className="p-3.5 rounded-xl bg-amber-950/40 border border-amber-800/70 text-amber-200 text-xs flex items-start gap-2 font-mono">
      <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
      <span>
        <strong>Temporary storage.</strong> {status.note} This server started at {new Date(status.startedAt).toLocaleString()}.
      </span>
    </div>
  );
};
