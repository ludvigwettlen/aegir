import { ShieldCheck } from 'lucide-react';
import type { Approval } from '../../../shared/types';
import { api, type Run } from './common';

export function ApprovalDock({ approvals, run }: { approvals: Approval[]; run: Run }) {
  const item = approvals[0];
  return (
    <div className="approval-dock">
      <div className="approval-icon">
        <ShieldCheck size={19} />
      </div>
      <div>
        <small>AGENT NEEDS YOUR APPROVAL</small>
        <strong>{item.title}</strong>
        <p className="approval-detail">{item.detail}</p>
      </div>
      <button
        className="small-button"
        onClick={() => void run(() => api.resolveApproval(item.id, false))}
      >
        Deny
      </button>
      <button
        className="primary-button"
        onClick={() => void run(() => api.resolveApproval(item.id, true))}
      >
        Approve
      </button>
    </div>
  );
}
