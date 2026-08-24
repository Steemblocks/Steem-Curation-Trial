import React, { useState } from 'react';
import { Key, ShieldCheck, UserCheck, AlertCircle, Sparkles, Sliders } from 'lucide-react';
import { joinTrial } from '../services/api';

export default function AuthPanel({ currentUser, onUserUpdated }) {
  const [username, setUsername] = useState(currentUser?.username || '');
  const [authType, setAuthType] = useState('keychain');
  const [postingKey, setPostingKey] = useState('');
  const [weight, setWeight] = useState(100);
  const [delay, setDelay] = useState(0);
  const [minVp, setMinVp] = useState(80);
  
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [successMsg, setSuccessMsg] = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!username.trim()) {
      setError('Please enter your Steem account username.');
      return;
    }

    setLoading(true);
    setError(null);
    setSuccessMsg(null);

    try {
      // Handle Steem Keychain authorization if available in window
      if (authType === 'keychain' && window.steem_keychain) {
        console.log('[Keychain] Requesting posting authority or sign for:', username);
      }

      const res = await joinTrial({
        username: username.trim().toLowerCase(),
        postingKey,
        authType,
        weight,
        delay,
        minVp
      });

      if (res.success) {
        setSuccessMsg(res.message);
        onUserUpdated(res.user, res.steemProfile);
      } else {
        setError(res.error || 'Failed to join trial');
      }
    } catch (err) {
      setError(err.message || 'Network error occurred');
    } finally {
      setLoading(false);
    }
  };

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
          <UserCheck size={20} />
        </div>
        <div>
          <h3 style={{ fontSize: '1.2rem', fontWeight: '700', margin: 0 }}>Join Curation Trial</h3>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: 0 }}>Connect your account to follow @dhaka.witness</p>
        </div>
      </div>

      {error && (
        <div style={{
          background: 'rgba(255, 51, 102, 0.12)',
          border: '1px solid rgba(255, 51, 102, 0.3)',
          color: 'var(--accent-rose)',
          padding: '0.75rem 1rem',
          borderRadius: '10px',
          fontSize: '0.875rem',
          marginBottom: '1rem',
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem'
        }}>
          <AlertCircle size={16} />
          {error}
        </div>
      )}

      {successMsg && (
        <div style={{
          background: 'rgba(0, 255, 135, 0.12)',
          border: '1px solid rgba(0, 255, 135, 0.3)',
          color: 'var(--accent-mint)',
          padding: '0.75rem 1rem',
          borderRadius: '10px',
          fontSize: '0.875rem',
          marginBottom: '1rem',
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem'
        }}>
          <Sparkles size={16} />
          {successMsg}
        </div>
      )}

      <form onSubmit={handleSubmit}>
        {/* Username */}
        <div className="form-group">
          <label className="form-label" htmlFor="steem-username-input">
            <span>Steem Account Username</span>
            <span style={{ color: 'var(--primary-cyan)', fontSize: '0.75rem' }}>Without @ symbol</span>
          </label>
          <input
            id="steem-username-input"
            type="text"
            className="form-input"
            placeholder="e.g. youraccount"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
          />
        </div>

        {/* Auth Method Tabs */}
        <div className="form-group">
          <label className="form-label">Authorization Method</label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
            <button
              type="button"
              id="auth-method-keychain"
              className={`btn ${authType === 'keychain' ? 'btn-primary' : 'btn-secondary'}`}
              style={{ justifyContent: 'center', fontSize: '0.85rem', padding: '0.6rem' }}
              onClick={() => setAuthType('keychain')}
            >
              <ShieldCheck size={16} />
              Steem Keychain
            </button>
            <button
              type="button"
              id="auth-method-key"
              className={`btn ${authType === 'key' ? 'btn-primary' : 'btn-secondary'}`}
              style={{ justifyContent: 'center', fontSize: '0.85rem', padding: '0.6rem' }}
              onClick={() => setAuthType('key')}
            >
              <Key size={16} />
              Posting Key
            </button>
          </div>
        </div>

        {authType === 'key' && (
          <div className="form-group">
            <label className="form-label" htmlFor="posting-key-input">
              <span>Private Posting Key</span>
              <span style={{ color: 'var(--accent-amber)', fontSize: '0.75rem' }}>AES-256 Encrypted</span>
            </label>
            <input
              id="posting-key-input"
              type="password"
              className="form-input"
              placeholder="5K... (Posting Key only)"
              value={postingKey}
              onChange={(e) => setPostingKey(e.target.value)}
              required={authType === 'key'}
            />
          </div>
        )}

        {/* Initial Settings Collapsible */}
        <div style={{
          background: 'rgba(8, 12, 20, 0.5)',
          padding: '1rem',
          borderRadius: '12px',
          border: '1px solid var(--border-glass)',
          marginBottom: '1.25rem'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem', color: 'var(--text-muted)', fontSize: '0.85rem', fontWeight: '600' }}>
            <Sliders size={14} color="var(--primary-cyan)" />
            Trial Preferences
          </div>

          <div style={{ marginBottom: '0.75rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', marginBottom: '0.25rem' }}>
              <span>Voting Weight Scale:</span>
              <strong style={{ color: 'var(--primary-cyan)' }}>{weight}%</strong>
            </div>
            <input
              id="weight-slider-initial"
              type="range"
              min="1"
              max="100"
              value={weight}
              onChange={(e) => setWeight(parseInt(e.target.value))}
            />
          </div>

          <div style={{ marginBottom: '0.75rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', marginBottom: '0.25rem' }}>
              <span>Vote Delay:</span>
              <strong style={{ color: 'var(--primary-cyan)' }}>{delay} minute{delay === 1 ? '' : 's'}</strong>
            </div>
            <select
              id="delay-select-initial"
              className="form-input"
              style={{ padding: '0.4rem 0.75rem', fontSize: '0.85rem', width: '100%' }}
              value={delay}
              onChange={(e) => setDelay(parseInt(e.target.value))}
            >
              <option value={0}>0 minutes (Instant match)</option>
              <option value={1}>1 minute</option>
              <option value={3}>3 minutes</option>
              <option value={5}>5 minutes</option>
              <option value={10}>10 minutes</option>
              <option value={15}>15 minutes</option>
            </select>
          </div>

          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', marginBottom: '0.25rem' }}>
              <span>Min VP Guard:</span>
              <strong style={{ color: 'var(--accent-mint)' }}>{minVp}% VP</strong>
            </div>
            <input
              id="min-vp-slider-initial"
              type="range"
              min="50"
              max="95"
              value={minVp}
              onChange={(e) => setMinVp(parseInt(e.target.value))}
            />
          </div>
        </div>

        <button
          type="submit"
          id="btn-submit-join"
          className="btn btn-primary"
          style={{ width: '100%', justifyContent: 'center', padding: '0.85rem' }}
          disabled={loading}
        >
          {loading ? 'Processing Authorization...' : '🚀 Authorize & Follow @dhaka.witness'}
        </button>
      </form>
    </div>
  );
}
