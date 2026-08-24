import React, { useState } from 'react';
import { Activity, Play, CheckCircle, AlertTriangle, XCircle, ExternalLink, RefreshCw } from 'lucide-react';
import { simulateTestVote } from '../services/api';

export default function ActivityFeed({ logs, onRefresh }) {
  const [testAuthor, setTestAuthor] = useState('steemit');
  const [testPermlink, setTestPermlink] = useState('');
  const [testWeight, setTestWeight] = useState(100);
  const [simulating, setSimulating] = useState(false);
  const [showSimModal, setShowSimModal] = useState(false);

  const handleSimulate = async (e) => {
    e.preventDefault();
    setSimulating(true);
    try {
      const permlink = testPermlink || 'test-curation-' + Math.floor(Math.random() * 10000);
      await simulateTestVote(testAuthor, permlink, testWeight);
      onRefresh();
      setShowSimModal(false);
      setTestPermlink('');
    } catch (err) {
      console.error('Failed to simulate vote:', err);
    } finally {
      setSimulating(false);
    }
  };

  const getStatusBadge = (status) => {
    switch (status) {
      case 'SUCCESS':
        return <span className="badge badge-success" style={{ gap: '0.25rem' }}><CheckCircle size={12} /> SUCCESS</span>;
      case 'SKIPPED_VP':
        return <span className="badge badge-warning" style={{ gap: '0.25rem' }}><AlertTriangle size={12} /> SKIPPED (LOW VP)</span>;
      case 'SKIPPED_SELF_VOTE':
        return <span className="badge badge-warning" style={{ gap: '0.25rem' }}><AlertTriangle size={12} /> SKIPPED (SELF-VOTE)</span>;
      case 'FAILED':
        return <span className="badge" style={{ background: 'rgba(255,51,102,0.15)', color: 'var(--accent-rose)', border: '1px solid rgba(255,51,102,0.3)', gap: '0.25rem' }}><XCircle size={12} /> FAILED</span>;
      default:
        return <span className="badge badge-info">{status}</span>;
    }
  };

  return (
    <div className="glass-card" style={{ padding: '1.75rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem', flexWrap: 'wrap', gap: '0.75rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
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
            <Activity size={20} />
          </div>
          <div>
            <h3 style={{ fontSize: '1.2rem', fontWeight: '700', margin: 0 }}>Live Curation Activity Feed</h3>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: 0 }}>Real-time votes processed by @dhaka.witness trial</p>
          </div>
        </div>

        <div style={{ display: 'flex', gap: '0.75rem' }}>
          <button
            type="button"
            id="btn-simulate-vote-open"
            className="btn btn-primary"
            style={{ fontSize: '0.85rem', padding: '0.5rem 1rem' }}
            onClick={() => setShowSimModal(!showSimModal)}
          >
            <Play size={14} /> Simulate Trail Vote
          </button>
          <button
            type="button"
            id="btn-refresh-feed"
            className="btn btn-secondary"
            style={{ padding: '0.5rem 0.75rem' }}
            onClick={onRefresh}
            title="Refresh Feed"
          >
            <RefreshCw size={14} />
          </button>
        </div>
      </div>

      {/* Simulation Form Modal / Panel */}
      {showSimModal && (
        <form onSubmit={handleSimulate} style={{
          background: 'rgba(8, 12, 20, 0.9)',
          border: '1px solid var(--primary-cyan)',
          padding: '1.25rem',
          borderRadius: '12px',
          marginBottom: '1.5rem',
          boxShadow: '0 0 20px rgba(0,242,254,0.15)'
        }}>
          <h4 style={{ fontSize: '1rem', color: 'var(--primary-cyan)', marginBottom: '0.75rem' }}>
            🧪 Test Curation Trial Dispatch
          </h4>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '1rem' }}>
            Simulate a vote cast by <strong>@dhaka.witness</strong> to test follower auto-voting instantly.
          </p>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 100px', gap: '0.75rem', marginBottom: '1rem' }}>
            <div>
              <label className="form-label" style={{ fontSize: '0.75rem' }}>Author Account</label>
              <input
                id="sim-author-input"
                type="text"
                className="form-input"
                style={{ padding: '0.5rem', fontSize: '0.85rem' }}
                placeholder="steemit"
                value={testAuthor}
                onChange={(e) => setTestAuthor(e.target.value)}
              />
            </div>
            <div>
              <label className="form-label" style={{ fontSize: '0.75rem' }}>Permlink</label>
              <input
                id="sim-permlink-input"
                type="text"
                className="form-input"
                style={{ padding: '0.5rem', fontSize: '0.85rem' }}
                placeholder="post-permlink"
                value={testPermlink}
                onChange={(e) => setTestPermlink(e.target.value)}
              />
            </div>
            <div>
              <label className="form-label" style={{ fontSize: '0.75rem' }}>Leader %</label>
              <input
                id="sim-weight-input"
                type="number"
                min="1"
                max="100"
                className="form-input"
                style={{ padding: '0.5rem', fontSize: '0.85rem' }}
                value={testWeight}
                onChange={(e) => setTestWeight(parseInt(e.target.value))}
              />
            </div>
          </div>

          <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
            <button
              type="button"
              className="btn btn-secondary"
              style={{ fontSize: '0.8rem', padding: '0.4rem 0.8rem' }}
              onClick={() => setShowSimModal(false)}
            >
              Cancel
            </button>
            <button
              type="submit"
              id="btn-run-sim-vote"
              className="btn btn-primary"
              style={{ fontSize: '0.8rem', padding: '0.4rem 1rem' }}
              disabled={simulating}
            >
              {simulating ? 'Broadcasting...' : '🚀 Trigger Trail Upvote'}
            </button>
          </div>
        </form>
      )}

      {/* Log Feed Table */}
      {logs.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '3rem 1rem', color: 'var(--text-muted)' }}>
          <Activity size={32} style={{ opacity: 0.3, marginBottom: '0.5rem' }} />
          <p style={{ margin: 0 }}>No trial vote logs recorded yet.</p>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-dim)' }}>
            Votes cast by @dhaka.witness on Steem will automatically display here.
          </p>
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="custom-table">
            <thead>
              <tr>
                <th>Leader</th>
                <th>Target Post</th>
                <th>Voter Account</th>
                <th>Weight</th>
                <th>Status</th>
                <th>Time</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => (
                <tr key={log.id}>
                  <td>
                    <strong style={{ color: 'var(--primary-cyan)' }}>@{log.leader}</strong>
                  </td>
                  <td>
                    <a
                      href={`https://steemit.com/@${log.author}/${log.permlink}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ color: 'var(--text-main)', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}
                    >
                      @{log.author}/{log.permlink.length > 18 ? log.permlink.substring(0, 18) + '...' : log.permlink}
                      <ExternalLink size={12} color="var(--text-dim)" />
                    </a>
                  </td>
                  <td>
                    <strong>@{log.voter}</strong>
                  </td>
                  <td>
                    <span style={{ color: 'var(--accent-mint)', fontWeight: '600' }}>{log.weight}%</span>
                  </td>
                  <td>
                    {getStatusBadge(log.status)}
                  </td>
                  <td style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                    {new Date(log.timestamp).toLocaleTimeString()}
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
