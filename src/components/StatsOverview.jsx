import React from 'react';
import { Layers, Zap, Users, ShieldCheck } from 'lucide-react';

export default function StatsOverview({ syncedBlock, activeMembersCount, totalVotesProcessed, leaderVp }) {
  const cards = [
    {
      title: 'Synced Block Height',
      value: syncedBlock ? `#${syncedBlock.toLocaleString()}` : 'Connecting...',
      icon: <Layers size={22} color="var(--primary-cyan)" />,
      color: 'var(--primary-cyan)',
      desc: 'Steem Blockchain Real-time Sync'
    },
    {
      title: 'Active Trail Subscribers',
      value: activeMembersCount,
      icon: <Users size={22} color="var(--accent-mint)" />,
      color: 'var(--accent-mint)',
      desc: 'Enrolled Follower Accounts'
    },
    {
      title: 'Total Trial Votes',
      value: totalVotesProcessed,
      icon: <Zap size={22} color="var(--primary-blue)" />,
      color: 'var(--primary-blue)',
      desc: 'Replicated Curation Upvotes'
    },
    {
      title: 'Leader Voting Power',
      value: `${leaderVp}%`,
      icon: <ShieldCheck size={22} color="var(--accent-amber)" />,
      color: 'var(--accent-amber)',
      desc: '@dhaka.witness Current VP'
    }
  ];

  return (
    <div className="grid-3" style={{ marginBottom: '2rem' }}>
      {cards.map((card, index) => (
        <div key={index} className="glass-card" style={{ padding: '1.25rem 1.5rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.75rem' }}>
            <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)', fontWeight: '500' }}>
              {card.title}
            </span>
            <div style={{
              background: 'rgba(255, 255, 255, 0.05)',
              padding: '0.5rem',
              borderRadius: '10px',
              border: '1px solid var(--border-glass)'
            }}>
              {card.icon}
            </div>
          </div>
          <div style={{ fontSize: '1.8rem', fontWeight: '800', color: card.color, lineHeight: 1.1, marginBottom: '0.25rem' }}>
            {card.value}
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>
            {card.desc}
          </div>
        </div>
      ))}
    </div>
  );
}
