import React from 'react';
import { Award, Zap, Users, CheckCircle, Flame, ExternalLink } from 'lucide-react';

export default function Hero({ leaderStats, totalVotesProcessed }) {
  const vp = leaderStats?.votingPower || 98.5;

  return (
    <div className="glass-card glass-card-glow" style={{ padding: '2rem', marginBottom: '2rem', position: 'relative', overflow: 'hidden' }}>
      {/* Glow background accent */}
      <div style={{
        position: 'absolute',
        top: '-40px',
        right: '-40px',
        width: '200px',
        height: '200px',
        background: 'radial-gradient(circle, rgba(0,242,254,0.15) 0%, transparent 70%)',
        pointerEvents: 'none'
      }}></div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '2rem', alignItems: 'center' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' }}>
            <span className="badge badge-info" style={{ textTransform: 'uppercase' }}>
              <Award size={13} /> Official Witness Trail
            </span>
            <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Steem Blockchain</span>
          </div>

          <h2 style={{ fontSize: '2.2rem', fontWeight: '800', marginBottom: '0.75rem', lineHeight: '1.2' }}>
            Follow <span className="gradient-text">@dhaka.witness</span> Curation Trail
          </h2>

          <p style={{ color: 'var(--text-muted)', fontSize: '1rem', maxWidth: '680px', marginBottom: '1.5rem' }}>
            Automate your Steem curation earnings! Connect your account to automatically follow upvotes cast by <strong>@dhaka.witness</strong> in real-time. Customize your vote weight, delay, and voting power protection thresholds.
          </p>

          <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.9rem' }}>
              <CheckCircle size={16} color="var(--accent-mint)" /> 100% Non-custodial / Key Encryption
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.9rem' }}>
              <CheckCircle size={16} color="var(--accent-mint)" /> Steem Keychain 1-Click Support
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.9rem' }}>
              <CheckCircle size={16} color="var(--accent-mint)" /> VP Protection Guard
            </div>
          </div>
        </div>

        {/* Leader Profile Card */}
        <div style={{
          background: 'rgba(8, 12, 20, 0.8)',
          border: '1px solid var(--border-glass)',
          borderRadius: '16px',
          padding: '1.5rem',
          minWidth: '280px',
          textAlign: 'center'
        }}>
          <div style={{ position: 'relative', width: '80px', height: '80px', margin: '0 auto 1rem auto' }}>
            <img 
              src={`https://steemitimages.com/u/dhaka.witness/avatar`} 
              alt="dhaka.witness avatar"
              onError={(e) => { e.target.src = 'https://steemitimages.com/u/steemit/avatar'; }}
              style={{
                width: '100%',
                height: '100%',
                borderRadius: '50%',
                border: '2px solid var(--primary-cyan)',
                boxShadow: '0 0 15px rgba(0, 242, 254, 0.4)'
              }}
            />
            <span style={{
              position: 'absolute',
              bottom: '0',
              right: '0',
              background: 'var(--bg-dark)',
              border: '1px solid var(--primary-cyan)',
              borderRadius: '9999px',
              padding: '2px 6px',
              fontSize: '0.7rem',
              fontWeight: '700',
              color: 'var(--primary-cyan)'
            }}>
              ({leaderStats?.reputation || 68})
            </span>
          </div>

          <h3 style={{ fontSize: '1.25rem', fontWeight: '700', margin: '0 0 0.25rem 0' }}>
            @dhaka.witness
          </h3>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-dim)', margin: '0 0 1rem 0' }}>
            Steem Top Witness & Curator
          </p>

          <div style={{ marginBottom: '1rem', textAlign: 'left' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.25rem' }}>
              <span>Leader Voting Power:</span>
              <strong style={{ color: 'var(--accent-mint)' }}>{vp}%</strong>
            </div>
            <div className="progress-bar-bg">
              <div className="progress-bar-fill" style={{ width: `${vp}%` }}></div>
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-around', borderTop: '1px solid var(--border-glass)', paddingTop: '0.75rem' }}>
            <div>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-dim)', display: 'block' }}>Total Trail Votes</span>
              <strong style={{ fontSize: '1.1rem', color: 'var(--primary-cyan)' }}>{totalVotesProcessed}</strong>
            </div>
            <div style={{ borderLeft: '1px solid var(--border-glass)' }}></div>
            <div>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-dim)', display: 'block' }}>Witness Status</span>
              <strong style={{ fontSize: '1.1rem', color: 'var(--accent-mint)' }}>Active</strong>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
