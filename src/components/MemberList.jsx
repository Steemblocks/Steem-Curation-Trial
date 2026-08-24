import React from 'react';
import { Users, Shield, Clock, Sliders } from 'lucide-react';

export default function MemberList({ members }) {
  return (
    <div className="glass-card" style={{ padding: '1.75rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.25rem' }}>
        <div style={{
          width: '36px',
          height: '36px',
          borderRadius: '10px',
          background: 'rgba(0, 242, 254, 0.15)',
          color: 'var(--primary-cyan)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center'
        }}>
          <Users size={20} />
        </div>
        <div>
          <h3 style={{ fontSize: '1.2rem', fontWeight: '700', margin: 0 }}>Enrolled Trial Subscribers</h3>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: 0 }}>Accounts currently replicating @dhaka.witness curation votes</p>
        </div>
      </div>

      {members.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '2rem 1rem', color: 'var(--text-muted)' }}>
          <p style={{ margin: 0 }}>No trial subscribers enrolled yet.</p>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-dim)' }}>Be the first account to join the curation trial!</p>
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="custom-table">
            <thead>
              <tr>
                <th>Member</th>
                <th>Auth Mode</th>
                <th>Vote Weight</th>
                <th>Delay</th>
                <th>Min VP</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {members.map((member) => (
                <tr key={member.username}>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                      <img
                        src={`https://steemitimages.com/u/${member.username}/avatar`}
                        alt={member.username}
                        onError={(e) => { e.target.src = 'https://steemitimages.com/u/steemit/avatar'; }}
                        style={{ width: '28px', height: '28px', borderRadius: '50%' }}
                      />
                      <strong style={{ color: 'var(--text-main)' }}>@{member.username}</strong>
                    </div>
                  </td>
                  <td>
                    <span className="badge badge-info" style={{ fontSize: '0.75rem' }}>
                      <Shield size={11} /> Posting Authority
                    </span>
                  </td>
                  <td>
                    <strong style={{ color: 'var(--primary-cyan)' }}>{member.weight}%</strong>
                  </td>
                  <td>
                    <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                      {member.delay === 0 ? 'Instant' : `${member.delay} min`}
                    </span>
                  </td>
                  <td>
                    <span style={{ color: 'var(--accent-mint)', fontSize: '0.85rem' }}>{member.min_vp}%</span>
                  </td>
                  <td>
                    <span className={`badge ${member.status === 'active' ? 'badge-success' : 'badge-warning'}`}>
                      {member.status === 'active' ? 'Active' : 'Paused'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
