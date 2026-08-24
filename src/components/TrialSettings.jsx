import React, { useState } from 'react';
import { Settings, Shield, Pause, Play, Trash2, Save, CheckCircle } from 'lucide-react';
import { updateSettings, toggleTrialStatus, leaveTrial } from '../services/api';

export default function TrialSettings({ user, steemProfile, onUpdate }) {
  const [weight, setWeight] = useState(user.weight || 100);
  const [delay, setDelay] = useState(user.delay || 0);
  const [minVp, setMinVp] = useState(user.min_vp || 80);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(null);

  const handleSave = async () => {
    setSaving(true);
    setMsg(null);
    try {
      const res = await updateSettings({
        username: user.username,
        weight,
        delay,
        minVp
      });
      if (res.success) {
        setMsg('Settings updated successfully!');
        onUpdate();
      }
    } catch (err) {
      console.error('Failed to update settings:', err);
    } finally {
      setSaving(false);
    }
  };

  const handleToggleStatus = async () => {
    const newStatus = user.status === 'active' ? 'paused' : 'active';
    try {
      const res = await toggleTrialStatus(user.username, newStatus);
      if (res.success) {
        onUpdate();
      }
    } catch (err) {
      console.error('Failed to toggle status:', err);
    }
  };

  const handleLeave = async () => {
    if (window.confirm(`Are you sure you want to remove @${user.username} from dhaka.witness curation trial?`)) {
      try {
        const res = await leaveTrial(user.username);
        if (res.success) {
          onUpdate(null);
        }
      } catch (err) {
        console.error('Failed to leave trial:', err);
      }
    }
  };

  const vp = steemProfile?.votingPower || 95;

  return (
    <div className="glass-card glass-card-glow" style={{ padding: '1.75rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <img
            src={`https://steemitimages.com/u/${user.username}/avatar`}
            alt={user.username}
            onError={(e) => { e.target.src = 'https://steemitimages.com/u/steemit/avatar'; }}
            style={{ width: '40px', height: '40px', borderRadius: '50%', border: '2px solid var(--primary-cyan)' }}
          />
          <div>
            <h3 style={{ fontSize: '1.2rem', fontWeight: '700', margin: 0 }}>
              @{user.username}
            </h3>
            <span className={`badge ${user.status === 'active' ? 'badge-success' : 'badge-warning'}`}>
              {user.status === 'active' ? '● Trial Active' : '⏸ Paused'}
            </span>
          </div>
        </div>

        <button
          type="button"
          id="btn-toggle-status"
          className={`btn ${user.status === 'active' ? 'btn-secondary' : 'btn-primary'}`}
          style={{ fontSize: '0.8rem', padding: '0.4rem 0.8rem' }}
          onClick={handleToggleStatus}
        >
          {user.status === 'active' ? <><Pause size={14} /> Pause</> : <><Play size={14} /> Resume</>}
        </button>
      </div>

      {/* Steem Account Live VP meter */}
      <div style={{ background: 'rgba(8, 12, 20, 0.6)', padding: '1rem', borderRadius: '12px', marginBottom: '1.25rem', border: '1px solid var(--border-glass)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', marginBottom: '0.4rem' }}>
          <span style={{ color: 'var(--text-muted)' }}>Voting Power (VP):</span>
          <strong style={{ color: 'var(--accent-mint)' }}>{vp}%</strong>
        </div>
        <div className="progress-bar-bg">
          <div className="progress-bar-fill" style={{ width: `${vp}%` }}></div>
        </div>
      </div>

      {msg && (
        <div style={{ color: 'var(--accent-mint)', fontSize: '0.85rem', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          <CheckCircle size={14} /> {msg}
        </div>
      )}

      {/* Settings Form */}
      <div className="form-group">
        <label className="form-label">
          <span>Vote Weight Scale</span>
          <strong style={{ color: 'var(--primary-cyan)' }}>{weight}%</strong>
        </label>
        <input
          id="settings-weight-slider"
          type="range"
          min="1"
          max="100"
          value={weight}
          onChange={(e) => setWeight(parseInt(e.target.value))}
        />
      </div>

      <div className="form-group">
        <label className="form-label">
          <span>Vote Delay</span>
          <strong style={{ color: 'var(--primary-cyan)' }}>{delay} min</strong>
        </label>
        <select
          id="settings-delay-select"
          className="form-input"
          value={delay}
          onChange={(e) => setDelay(parseInt(e.target.value))}
        >
          <option value={0}>0 mins (Instant)</option>
          <option value={1}>1 minute</option>
          <option value={3}>3 minutes</option>
          <option value={5}>5 minutes</option>
          <option value={10}>10 minutes</option>
          <option value={15}>15 minutes</option>
        </select>
      </div>

      <div className="form-group">
        <label className="form-label">
          <span>Minimum VP Protection Threshold</span>
          <strong style={{ color: 'var(--accent-mint)' }}>{minVp}% VP</strong>
        </label>
        <input
          id="settings-minvp-slider"
          type="range"
          min="50"
          max="95"
          value={minVp}
          onChange={(e) => setMinVp(parseInt(e.target.value))}
        />
      </div>

      <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1.5rem' }}>
        <button
          type="button"
          id="btn-save-settings"
          className="btn btn-primary"
          style={{ flex: 1, justifyContent: 'center' }}
          onClick={handleSave}
          disabled={saving}
        >
          <Save size={16} />
          {saving ? 'Saving...' : 'Save Settings'}
        </button>

        <button
          type="button"
          id="btn-leave-trial"
          className="btn btn-danger"
          style={{ justifyContent: 'center' }}
          onClick={handleLeave}
          title="Leave Curation Trial"
        >
          <Trash2 size={16} />
        </button>
      </div>
    </div>
  );
}
