import React from 'react';
import { Shield, Radio, Layers, Activity } from 'lucide-react';

export default function Header({ syncedBlock, activeMembersCount, steemNodeStatus = 'Online' }) {
  return (
    <header className="glass-card" style={{ marginBottom: '2rem', padding: '1rem 1.5rem', borderRadius: '16px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <div style={{
            width: '42px',
            height: '42px',
            borderRadius: '12px',
            background: 'linear-gradient(135deg, #00F2FE 0%, #4FACFE 100%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#030712',
            fontWeight: '800',
            fontSize: '1.25rem',
            boxShadow: '0 0 15px rgba(0, 242, 254, 0.4)'
          }}>
            ⚡
          </div>
          <div>
            <h1 style={{ fontSize: '1.35rem', fontWeight: '800', margin: 0, lineHeight: 1.2 }}>
              <span className="gradient-text">STEEM</span> CURATION TRIAL
            </h1>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: 0 }}>
              Official Auto-Vote Tool for <strong style={{ color: 'var(--primary-cyan)' }}>@dhaka.witness</strong>
            </p>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
          <div className="badge badge-info" style={{ gap: '0.4rem' }}>
            <Layers size={14} />
            Block #{syncedBlock || '...'}
          </div>

          <div className="badge badge-success" style={{ gap: '0.4rem' }}>
            <Activity size={14} />
            {activeMembersCount} Active Trial Member{activeMembersCount === 1 ? '' : 's'}
          </div>

          <div className="badge badge-success" style={{ gap: '0.4rem' }}>
            <span className="pulse-dot"></span>
            Steem Node: {steemNodeStatus}
          </div>
        </div>
      </div>
    </header>
  );
}
