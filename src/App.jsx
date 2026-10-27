import React, { useState, useEffect, useCallback } from 'react';
import { 
  Shield, 
  Key, 
  Settings, 
  Activity, 
  LogOut, 
  RefreshCw, 
  ExternalLink, 
  Check, 
  AlertCircle, 
  Layers, 
  Play, 
  Pause, 
  Trash2,
  Sliders,
  Plus,
  X,
  UserCheck,
  Edit2,
  ChevronLeft,
  ChevronRight,
  LayoutDashboard,
  Zap,
  Cog,
  Server,
  Gift
} from 'lucide-react';

const SESSION_STORAGE_KEY = 'steem_curation_session';
const JWT_STORAGE_KEY = 'steem_curation_jwt';

// ── API Helpers ─────────────────────────────────────────────────────────────
const getAuthHeaders = () => {
  const token = localStorage.getItem(JWT_STORAGE_KEY);
  return token ? { 'Authorization': `Bearer ${token}` } : {};
};

const handleAuthError = () => {
  if (typeof window !== 'undefined' && window.dispatchEvent) {
    window.dispatchEvent(new CustomEvent('steem_auth_expired'));
  }
};

const api = (path) => fetch('/api' + path, {
  headers: { ...getAuthHeaders() }
}).then(async r => {
  if (r.status === 401 && !path.startsWith('/auth') && path !== '/status') {
    handleAuthError();
  }
  return r.json();
});

const post = (path, body) => fetch('/api' + path, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
  body: JSON.stringify(body),
}).then(async r => {
  if (r.status === 401 && path !== '/login' && path !== '/join' && !path.startsWith('/auth')) {
    handleAuthError();
  }
  return r.json();
});

// ── Steem Keychain Helpers ──────────────────────────────────────────────────
const hasKeychain = () => typeof window !== 'undefined' && !!window.steem_keychain;

function keychainSignMessage(username, message) {
  return new Promise((resolve) => {
    window.steem_keychain.requestSignBuffer(username, message, 'Posting', (res) => {
      if (res.success && res.result) {
        resolve({ ok: true, signature: res.result });
      } else {
        resolve({ ok: false, error: res.message || 'Keychain signature was cancelled or rejected.' });
      }
    });
  });
}

function keychainGrantAuthority({ username, botAccount, currentPosting, memoKey, jsonMetadata }) {
  return new Promise((resolve) => {
    const existingAuths = (currentPosting?.account_auths ?? []).filter(([a]) => a.toLowerCase() !== botAccount.toLowerCase());
    const newPosting = {
      weight_threshold: currentPosting?.weight_threshold || 1,
      account_auths: [...existingAuths, [botAccount, 1]].sort((a, b) => a[0].localeCompare(b[0])),
      key_auths: currentPosting?.key_auths || [],
    };

    window.steem_keychain.requestBroadcast(
      username,
      [['account_update', {
        account: username,
        posting: newPosting,
        memo_key: memoKey,
        json_metadata: jsonMetadata || ''
      }]],
      'Active',
      (res) => {
        if (res.success) resolve({ ok: true });
        else resolve({ ok: false, error: res.message || 'Keychain rejected account authority update.' });
      }
    );
  });
}

function keychainRevokeAuthority({ username, botAccount, currentPosting, memoKey, jsonMetadata }) {
  return new Promise((resolve) => {
    const newPosting = {
      weight_threshold: currentPosting?.weight_threshold || 1,
      account_auths: (currentPosting?.account_auths ?? [])
        .filter(([a]) => a.toLowerCase() !== botAccount.toLowerCase())
        .sort((a, b) => a[0].localeCompare(b[0])),
      key_auths: currentPosting?.key_auths || [],
    };

    window.steem_keychain.requestBroadcast(
      username,
      [['account_update', {
        account: username,
        posting: newPosting,
        memo_key: memoKey,
        json_metadata: jsonMetadata || ''
      }]],
      'Active',
      (res) => {
        if (res.success) resolve({ ok: true });
        else resolve({ ok: false, error: res.message || 'Keychain rejected authority revocation.' });
      }
    );
  });
}

/** Broadcast account_update using Active key with automatic Steem RPC node failover */
async function broadcastAccountUpdate(activeKey, username, posting, memoKey, jsonMetadata) {
  const nodes = ['https://api.moecki.online', 'https://api.steemit.com', 'https://api.justyy.com', 'https://api.steem.fans'];
  let lastErr = null;
  for (const nodeUrl of nodes) {
    try {
      window.steem.api.setOptions({ url: nodeUrl });
      return await new Promise((resolve, reject) => {
        window.steem.broadcast.accountUpdate(
          activeKey,
          username,
          undefined,
          undefined,
          posting,
          memoKey,
          jsonMetadata || '',
          (err, result) => {
            if (err) reject(err);
            else resolve(result);
          }
        );
      });
    } catch (e) {
      lastErr = e;
      const msg = e?.message || String(e);
      // Fail immediately on key/authority errors without node retry
      if (msg.includes('missing required active authority') || msg.includes('Invalid WIF') || msg.includes('Missing parameter')) {
        throw e;
      }
    }
  }
  throw lastErr || new Error('Broadcast failed across all Steem RPC nodes.');
}

// ── Components ──────────────────────────────────────────────────────────────

function VotingPowerMeter({ vp = 0 }) {
  const numericVp = Math.min(100, Math.max(0, parseFloat(vp) || 0));
  let barClass = '';
  if (numericVp < 70) barClass = 'danger';
  else if (numericVp < 85) barClass = 'warning';

  return (
    <div>
      <div className="form-label" style={{ marginBottom: '0.35rem' }}>
        <span>Voting Power</span>
        <strong style={{ color: numericVp < 70 ? 'var(--color-danger)' : numericVp < 85 ? 'var(--color-warning)' : 'var(--color-success)' }}>
          {numericVp.toFixed(1)}%
        </strong>
      </div>
      <div className="progress-container">
        <div className={`progress-bar ${barClass}`} style={{ width: `${numericVp}%` }} />
      </div>
    </div>
  );
}

function VoteStatusBadge({ status, error }) {
  // Never show blacklist details in tooltip for privacy protection
  const isBlacklist = status === 'SKIPPED_BLACKLIST' || (error && error.toLowerCase().includes('blacklist'));
  const title = isBlacklist ? undefined : (error || undefined);
  switch (status) {
    case 'SUCCESS':
      return <span className="badge badge-success" title={title}>Voted</span>;
    case 'SKIPPED_VP':
      return <span className="badge badge-warning" title={title}>Low VP</span>;
    case 'FAILED':
      return <span className="badge badge-danger" title={title} style={{ cursor: error ? 'help' : 'default' }}>Failed</span>;
    case 'SKIPPED_SELF_VOTE':
    case 'SKIPPED_KEYCHAIN':
    case 'SKIPPED_BLACKLIST':
    case 'SKIPPED':
      return <span className="badge badge-neutral" title={title}>Skipped</span>;
    default:
      if (status && String(status).startsWith('SKIPPED')) {
        return <span className="badge badge-neutral" title={title}>Skipped</span>;
      }
      return <span className="badge badge-neutral" title={title}>{status}</span>;
  }
}

function AuthorityModal({ isOpen, mode, username, botAccount, isProcessing, onConfirmKeychain, onConfirmActiveKey, onCancel }) {
  const [authMethod, setAuthMethod] = useState('keychain');
  const [activeKey, setActiveKey] = useState('');
  const [error, setError] = useState('');

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen) {
      setAuthMethod('keychain');
      setActiveKey('');
      setError('');
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSubmit = (e) => {
    e.preventDefault();
    setError('');

    if (authMethod === 'keychain') {
      onConfirmKeychain();
    } else {
      if (!activeKey.trim()) {
        setError('Please enter your private active key.');
        return;
      }
      const rawKey = activeKey.trim();
      // Instantly wipe active key from component state so it never lingers in memory
      setActiveKey('');
      onConfirmActiveKey(rawKey, (err) => {
        if (err) setError(err);
      });
    }
  };

  const isGrant = mode === 'grant';
  const title = isGrant ? 'Grant Posting Authority' : 'Revoke Posting Authority';
  const actionText = isGrant ? 'Grant Authority' : 'Revoke Authority';
  
  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      backgroundColor: 'rgba(0, 0, 0, 0.75)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: '1rem', zIndex: 1000,
    }}>
      <div className="card" style={{ width: '100%', maxWidth: '440px', padding: '1.75rem', position: 'relative' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <h3 style={{ fontSize: '1.1rem', fontWeight: '700', margin: 0, color: 'var(--text-primary)' }}>
            {title}
          </h3>
          <button
            type="button"
            onClick={() => { setActiveKey(''); onCancel(); }}
            disabled={isProcessing}
            style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', padding: 0 }}
          >
            <X size={18} />
          </button>
        </div>

        <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', lineHeight: '1.5', marginBottom: '1.25rem' }}>
          {isGrant 
            ? <>Authorize <strong style={{ color: 'var(--text-primary)' }}>@{botAccount}</strong> to cast votes on your behalf. This requires an Active Key signature.</>
            : <>Remove <strong style={{ color: 'var(--text-primary)' }}>@{botAccount}</strong> from your posting authorities. This requires an Active Key signature.</>}
        </p>

        {/* Tab Selection */}
        <div className="tabs-container" style={{ marginBottom: '1.25rem' }}>
          <button
            type="button"
            className={`tab-button ${authMethod === 'keychain' ? 'active' : ''}`}
            onClick={() => { setAuthMethod('keychain'); setActiveKey(''); setError(''); }}
          >
            Steem Keychain
          </button>
          <button
            type="button"
            className={`tab-button ${authMethod === 'active_key' ? 'active' : ''}`}
            onClick={() => { setAuthMethod('active_key'); setError(''); }}
          >
            Active Key
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          {authMethod === 'keychain' ? (
            <div className="alert-box alert-info" style={{ marginBottom: '1.25rem', fontSize: '0.85rem', lineHeight: '1.45' }}>
              Click below to securely sign the account update transaction using the Steem Keychain extension.
            </div>
          ) : (
            <div className="form-group" style={{ marginBottom: '1.25rem' }}>
              <label className="form-label">Private Active Key</label>
              <input
                type="password"
                className="form-input"
                placeholder="5J..."
                value={activeKey}
                onChange={(e) => setActiveKey(e.target.value)}
                disabled={isProcessing}
                autoComplete="off"
                required
              />
              <div className="alert-box alert-info" style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: '0.5rem',
                marginTop: '0.65rem',
                marginBottom: 0,
                fontSize: '0.8rem',
                lineHeight: '1.45',
              }}>
                <Shield size={14} style={{ flexShrink: 0, marginTop: '2px', color: '#60a5fa' }} />
                <span><strong style={{ color: 'var(--text-primary)' }}>Client-Side Only:</strong> Your active key broadcasts directly to public Steem RPC nodes (api.steemit.com). It is wiped from memory immediately and NEVER touches our server.</span>
              </div>
            </div>
          )}

          {error && (
            <div className="alert-box alert-error" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1.25rem' }}>
              <AlertCircle size={14} />
              <span>{error}</span>
            </div>
          )}

          <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
            <button type="button" className="btn btn-secondary btn-sm" onClick={onCancel} disabled={isProcessing}>
              Cancel
            </button>
            <button type="submit" className={`btn ${isGrant ? 'btn-primary' : 'btn-danger'} btn-sm`} disabled={isProcessing}>
              {isProcessing ? 'Processing...' : actionText}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function ConfirmModal({ isOpen, title, message, confirmText, confirmStyle = 'btn-danger', isProcessing, onConfirm, onCancel }) {
  if (!isOpen) return null;

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: 'rgba(0, 0, 0, 0.75)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '1rem',
      zIndex: 1000,
    }}>
      <div className="card" style={{ width: '100%', maxWidth: '440px', padding: '1.75rem', position: 'relative' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <h3 style={{ fontSize: '1.1rem', fontWeight: '700', margin: 0, color: 'var(--text-primary)' }}>
            {title}
          </h3>
          <button
            type="button"
            onClick={onCancel}
            disabled={isProcessing}
            style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', padding: 0 }}
          >
            <X size={18} />
          </button>
        </div>

        <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', lineHeight: '1.5', marginBottom: '1.5rem' }}>
          {message}
        </p>

        <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={onCancel}
            disabled={isProcessing}
          >
            Cancel
          </button>
          <button
            type="button"
            className={`btn ${confirmStyle} btn-sm`}
            onClick={onConfirm}
            disabled={isProcessing}
          >
            {isProcessing ? 'Processing...' : confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Login Wall ──────────────────────────────────────────────────────────────
function LoginWall({ botAccount, onAuthenticated }) {
  const [authMethod, setAuthMethod] = useState('keychain');
  const [username, setUsername] = useState('');
  const [postingKey, setPostingKey] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleLoginSubmit = async (e) => {
    e.preventDefault();
    const cleanUser = username.trim().toLowerCase();

    if (!cleanUser) {
      setError('Please enter your Steem username.');
      return;
    }

    setLoading(true);
    setError('');

    try {
      // 1. Verify Steem account exists
      const userCheck = await api(`/user/${cleanUser}`);
      if (!userCheck.steemProfile) {
        setLoading(false);
        setError(`Steem account @${cleanUser} does not exist on blockchain.`);
        return;
      }

      // 2. Request single-use cryptographic challenge from server
      const challengeRes = await post('/auth/challenge', { username: cleanUser });
      if (!challengeRes.success || !challengeRes.challenge) {
        setLoading(false);
        setError(challengeRes.error || 'Failed to request login challenge from server.');
        return;
      }
      const challengeMessage = challengeRes.challenge;

      let signature = '';

      // 3. Handle Keychain Auth Flow
      if (authMethod === 'keychain') {
        if (!hasKeychain()) {
          setLoading(false);
          setError('Steem Keychain extension is not installed in this browser.');
          return;
        }

        const signResult = await keychainSignMessage(cleanUser, challengeMessage);
        if (!signResult.ok) {
          setLoading(false);
          setError(signResult.error);
          return;
        }
        signature = signResult.signature;
      } 
      // 4. Handle Posting Key Auth Flow (ZERO-KNOWLEDGE / CLIENT-SIDE ONLY)
      else {
        if (!postingKey.trim()) {
          setLoading(false);
          setError('Please enter your Private Posting Key.');
          return;
        }

        try {
          const privWif = postingKey.trim();
          // Instantly wipe posting key from component state so it never lingers in memory
          setPostingKey('');

          if (!window.steem?.auth?.signature?.signBuffer) {
            throw new Error('Steem cryptographic module not loaded. Please refresh the page.');
          }
          const sigObj = window.steem.auth.signature.signBuffer(challengeMessage, privWif);
          signature = sigObj.toHex();
        } catch (e) {
          setPostingKey('');
          setLoading(false);
          setError(e.message || 'Failed to sign challenge with Private Posting Key. Please verify key format.');
          return;
        }
      }

      // 5. Submit ONLY username and signature to server to verify identity and issue JWT
      const loginRes = await post('/login', { username: cleanUser, signature });

      if (loginRes.success) {
        onAuthenticated(loginRes.user, loginRes.steemProfile, loginRes.trails, loginRes.token);
      } else {
        setError(loginRes.error || 'Failed to authenticate.');
      }
    } catch (err) {
      setError('Connection to server failed. Please try again.');
    } finally {
      // Ensure posting key state is always completely wiped
      setPostingKey('');
      setLoading(false);
    }
  };

  return (
    <div className="container-auth">
      <div className="card" style={{ width: '100%', maxWidth: '440px', padding: '2rem' }}>
        <div style={{ textAlign: 'center', marginBottom: '1.75rem' }}>
          <h1 style={{ fontSize: '1.35rem', fontWeight: '700', marginBottom: '0.35rem' }}>
            Steem Curation Trial
          </h1>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
            Sign in to manage your automated curation trails
          </p>
        </div>

        {error && (
          <div className="alert-box alert-error" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <AlertCircle size={16} />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleLoginSubmit}>
          <div className="tabs-container">
            <button
              type="button"
              className={`tab-button ${authMethod === 'keychain' ? 'active' : ''}`}
              onClick={() => { setAuthMethod('keychain'); setPostingKey(''); setError(''); }}
            >
              Steem Keychain
            </button>
            <button
              type="button"
              className={`tab-button ${authMethod === 'key' ? 'active' : ''}`}
              onClick={() => { setAuthMethod('key'); setError(''); }}
            >
              Posting Key
            </button>
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="login-username-input">
              <span>Steem Username</span>
            </label>
            <input
              id="login-username-input"
              type="text"
              className="form-input"
              placeholder="Steem Id"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="off"
              spellCheck="false"
              required
            />
          </div>

          {authMethod === 'key' && (
            <div className="form-group">
              <label className="form-label" htmlFor="login-postingkey-input">
                <span>Private Posting Key</span>
              </label>
              <input
                id="login-postingkey-input"
                type="password"
                className="form-input"
                placeholder="5J..."
                value={postingKey}
                onChange={(e) => setPostingKey(e.target.value)}
                autoComplete="off"
                required={authMethod === 'key'}
              />
              <div className="alert-box alert-info" style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: '0.5rem',
                marginTop: '0.65rem',
                marginBottom: 0,
                fontSize: '0.8rem',
                lineHeight: '1.45',
              }}>
                <Shield size={14} style={{ flexShrink: 0, marginTop: '2px', color: '#60a5fa' }} />
                <span><strong style={{ color: 'var(--text-primary)' }}>Client-Side Only:</strong> Your posting key signs a challenge in browser memory and is wiped immediately. Only the cryptographic signature is sent to the server. Your key NEVER leaves your device.</span>
              </div>
            </div>
          )}

          {authMethod === 'keychain' && (
            <div className="alert-box alert-info" style={{ fontSize: '0.8rem', lineHeight: '1.45', marginBottom: '1.25rem' }}>
              Secure 1-click sign in with Steem Keychain. You can grant authority for background voting from the dashboard after logging in.
            </div>
          )}

          <button
            type="submit"
            id="login-submit-btn"
            className="btn btn-primary btn-full"
            disabled={loading}
            style={{ marginTop: '0.5rem' }}
          >
            {loading ? 'Authenticating...' : 'Sign In'}
          </button>
        </form>
      </div>
    </div>
  );
}

// ── Follow New Trail Modal / Form ───────────────────────────────────────────
function AddTrailModal({ isOpen, onClose, onAddTrail }) {
  const [targetAccount, setTargetAccount] = useState('');
  const [weight, setWeight] = useState(100);
  const [delay, setDelay] = useState(0);
  const [minVp, setMinVp] = useState(80);
  const [allowUpvotes, setAllowUpvotes] = useState(true);
  const [allowDownvotes, setAllowDownvotes] = useState(true);
  
  // Real-time verification state
  const [checking, setChecking] = useState(false);
  const [verifiedAccount, setVerifiedAccount] = useState(null);
  const [verifyError, setVerifyError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Debounced Steem account lookup
  useEffect(() => {
    const clean = targetAccount.trim().toLowerCase();
    if (!clean || clean.length < 3) {
      setVerifiedAccount(null);
      setVerifyError('');
      return;
    }

    setChecking(true);
    setVerifyError('');
    const timer = setTimeout(async () => {
      try {
        const res = await api(`/verify/${clean}`);
        if (res.success && res.profile) {
          setVerifiedAccount(res.profile);
          setVerifyError('');
        } else {
          setVerifiedAccount(null);
          setVerifyError(`Account @${clean} does not exist on Steem blockchain.`);
        }
      } catch (e) {
        setVerifiedAccount(null);
        setVerifyError('Failed to verify account on Steem.');
      } finally {
        setChecking(false);
      }
    }, 500);

    return () => clearTimeout(timer);
  }, [targetAccount]);

  if (!isOpen) return null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!verifiedAccount) {
      setVerifyError('Please enter a valid Steem account name.');
      return;
    }

    setSubmitting(true);
    try {
      await onAddTrail({
        trailAccount: verifiedAccount.name,
        weight: parseInt(weight, 10),
        delay: parseInt(delay, 10),
        minVp: parseInt(minVp, 10),
        allowUpvotes,
        allowDownvotes,
        maxDailyVotes: 0,
        whitelist: '',
        blacklist: ''
      });
      // Reset form
      setTargetAccount('');
      setVerifiedAccount(null);
      onClose();
    } catch (err) {
      setVerifyError(err.message || 'Failed to add trail.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: 'rgba(0, 0, 0, 0.75)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '1rem',
      zIndex: 1000,
    }}>
      <div className="card" style={{ width: '100%', maxWidth: '480px', padding: '1.75rem', position: 'relative' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
          <h3 style={{ fontSize: '1.15rem', fontWeight: '700', margin: 0, color: 'var(--text-primary)' }}>
            Follow New Curation Trail
          </h3>
          <button
            type="button"
            onClick={onClose}
            style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', padding: 0 }}
          >
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label" htmlFor="new-trail-input">
              <span>Account to Follow</span>
              {checking && <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Verifying on Steem...</span>}
            </label>
            <input
              id="new-trail-input"
              type="text"
              className="form-input"
              placeholder="e.g. dhaka.witness or steemcurator01"
              value={targetAccount}
              onChange={(e) => setTargetAccount(e.target.value)}
              autoComplete="off"
              spellCheck="false"
              required
            />
          </div>

          {/* Account Verification Feedback Card */}
          {verifiedAccount && (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '0.75rem 1rem',
              backgroundColor: 'var(--bg-input)',
              border: '1px solid rgba(34, 197, 94, 0.3)',
              borderRadius: 'var(--radius-sm)',
              marginBottom: '1rem'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <img
                  src={`https://steemitimages.com/u/${verifiedAccount.name}/avatar`}
                  onError={(e) => { e.target.src = 'https://steemitimages.com/u/steemit/avatar'; }}
                  alt={verifiedAccount.name}
                  style={{ width: '32px', height: '32px', borderRadius: '50%' }}
                />
                <div>
                  <div style={{ fontWeight: '600', fontSize: '0.9rem' }}>@{verifiedAccount.name}</div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                    Reputation {verifiedAccount.reputation} · {verifiedAccount.votingPower}% VP
                  </div>
                </div>
              </div>
              <span className="badge badge-success">Verified</span>
            </div>
          )}

          {verifyError && (
            <div className="alert-box alert-error" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem' }}>
              <AlertCircle size={14} />
              <span>{verifyError}</span>
            </div>
          )}

          <div className="form-group">
            <div className="form-label">
              <span>Vote Weight Scale</span>
              <strong>{weight}%</strong>
            </div>
            <input
              type="range"
              min="1"
              max="100"
              value={weight}
              onChange={(e) => setWeight(parseInt(e.target.value, 10))}
            />
          </div>

          <div className="form-group">
            <label className="form-label">
              <span>Vote Delay</span>
            </label>
            <select
              className="form-input"
              value={delay}
              onChange={(e) => setDelay(parseInt(e.target.value, 10))}
            >
              <option value={0}>Instant (0 minutes)</option>
              <option value={1}>1 minute</option>
              <option value={3}>3 minutes</option>
              <option value={5}>5 minutes</option>
              <option value={10}>10 minutes</option>
              <option value={15}>15 minutes</option>
            </select>
          </div>

          <div className="form-group">
            <div className="form-label">
              <span>Min Voting Power Guard</span>
              <strong>{minVp}%</strong>
            </div>
            <input
              type="range"
              min="50"
              max="95"
              value={minVp}
              onChange={(e) => setMinVp(parseInt(e.target.value, 10))}
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1.25rem' }}>
            <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-start', gap: '0.5rem', cursor: 'pointer', margin: 0, color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
              <input
                type="checkbox"
                checked={allowUpvotes}
                onChange={(e) => setAllowUpvotes(e.target.checked)}
                style={{ width: '16px', height: '16px', accentColor: 'var(--primary-cyan)' }}
              />
              <span>Allow Upvotes</span>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-start', gap: '0.5rem', cursor: 'pointer', margin: 0, color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
              <input
                type="checkbox"
                checked={allowDownvotes}
                onChange={(e) => setAllowDownvotes(e.target.checked)}
                style={{ width: '16px', height: '16px', accentColor: 'var(--accent-rose)' }}
              />
              <span>Allow Downvotes</span>
            </label>
          </div>



          <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1.25rem' }}>
            <button
              type="button"
              className="btn btn-secondary btn-full"
              onClick={onClose}
              disabled={submitting}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-primary btn-full"
              disabled={submitting || !verifiedAccount}
            >
              {submitting ? 'Adding...' : 'Follow Account'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Dashboard Stats Components ───────────────────────────────────────────────

function StatCard({ icon: Icon, iconBg, iconColor, value, label, sub }) {
  return (
    <div className="stat-card">
      <div className="stat-card-icon" style={{ backgroundColor: iconBg }}>
        <Icon size={16} color={iconColor} />
      </div>
      <div className="stat-card-value">{value}</div>
      <div>
        <div className="stat-card-label">{label}</div>
        {sub && <div className="stat-card-sub">{sub}</div>}
      </div>
    </div>
  );
}

// ── Date helpers ── SQLite stores UTC as "YYYY-MM-DD HH:MM:SS" (no 'T', no zone)
const parseSqlTs = (ts) => (ts ? new Date(String(ts).replace(' ', 'T') + 'Z') : null);
// Local calendar date as YYYY-MM-DD (toISOString() would give the UTC date)
const localDateStr = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const formatLogTime = (ts) => {
  const d = parseSqlTs(ts);
  if (!d || isNaN(d)) return '—';
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (localDateStr(d) === localDateStr(new Date())) return time;
  const sameYear = d.getFullYear() === new Date().getFullYear();
  const date = d.toLocaleDateString([], { month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) });
  return `${date}, ${time}`;
};

function DashboardStats({ logs, status, trails, username }) {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [autoVoteCount, setAutoVoteCount] = useState(0);

  useEffect(() => {
    // Send our UTC offset and username so stats are user-specific
    api(`/stats?tz=${-new Date().getTimezoneOffset()}${username ? `&user=${username}` : ''}`)
      .then(res => { if (res.success) setStats(res); })
      .catch(() => {})
      .finally(() => setLoading(false));
    // Fetch auto-vote target count for this user
    if (username) {
      api(`/autovote/${username}`)
        .then(res => { if (res.success) setAutoVoteCount(res.targets?.length ?? 0); })
        .catch(() => {});
    }
  }, [username]);

  // Totals — prefer server stats, fall back to log-derived counts
  // NOTE: never fall back to status.totalVotes — that is the app-wide count, not this user's
  const totalSuccess = stats?.breakdown?.success ?? 0;
  const totalFailed  = stats?.breakdown?.failed  ?? logs.filter(l => l.status === 'FAILED').length;
  const totalSkipped = stats?.breakdown?.skipped ?? logs.filter(l => l.status?.startsWith('SKIPPED')).length;
  const totalAll     = stats?.breakdown?.total   ?? (totalSuccess + totalFailed + totalSkipped);
  const todaySuccess = stats?.todaySuccess ?? 0;
  const weekSuccess  = stats?.weekSuccess  ?? 0;
  const activeUsers  = stats?.activeUsers  ?? status?.activeMembers ?? 0;
  const followedLeaders = stats?.followedLeaders ?? 0;
  const successRate  = totalAll > 0 ? ((totalSuccess / totalAll) * 100).toFixed(1) : '0.0';

  const leaderStats = stats?.leaderStats ?? [];
  const maxLeaderTotal = Math.max(...leaderStats.map(l => l.total), 1);

  // Build last 7 days — fill gaps where no votes occurred
  const dailyRaw = stats?.dailyVotes ?? [];
  const last7Days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (6 - i));
    const dateStr = localDateStr(d);
    const found = dailyRaw.find(v => v.date === dateStr) || { total: 0, success: 0, failed: 0, skipped: 0 };
    return { ...found, date: dateStr, label: d.toLocaleDateString('en', { weekday: 'short' }) };
  });
  const maxDaily = Math.max(...last7Days.map(d => d.total), 1);

  // Overview bar percentages
  const pctSuccess = totalAll ? (totalSuccess / totalAll) * 100 : 0;
  const pctSkipped = totalAll ? (totalSkipped / totalAll) * 100 : 0;
  const pctFailed  = totalAll ? (totalFailed  / totalAll) * 100 : 0;

  if (loading && !stats) {
    return (
      <div className="stats-loading">
        <RefreshCw size={14} className="spin-active" />
        Loading stats…
      </div>
    );
  }

  return (
    <div style={{ marginBottom: '1.5rem' }}>

      {/* ── Stat Cards ── */}
      <div className="stats-grid">
        <StatCard
          icon={Check}
          iconBg="rgba(16,185,129,0.12)"
          iconColor="#10b981"
          value={totalSuccess.toLocaleString()}
          label="Total Votes Cast"
          sub={`${weekSuccess.toLocaleString()} this week`}
        />
        <StatCard
          icon={Activity}
          iconBg="rgba(59,130,246,0.12)"
          iconColor="#60a5fa"
          value={todaySuccess.toLocaleString()}
          label="Today's Votes"
          sub="since local midnight"
        />
        <StatCard
          icon={UserCheck}
          iconBg="rgba(139,92,246,0.12)"
          iconColor="#a78bfa"
          value={`${successRate}%`}
          label="Success Rate"
          sub={`${totalAll.toLocaleString()} total attempts`}
        />
        <StatCard
          icon={Layers}
          iconBg="rgba(245,158,11,0.12)"
          iconColor="#fbbf24"
          value={trails.length}
          label="Followed Leaders"
          sub={`${autoVoteCount} auto-vote target${autoVoteCount !== 1 ? 's' : ''}`}
        />
      </div>

      {/* ── Two-column: Distribution + 7-Day Trend ── */}
      <div className="grid-2col" style={{ marginBottom: '1.25rem', gap: '1.25rem' }}>

        {/* Vote Distribution */}
        <div className="card" style={{ margin: 0 }}>
          <div className="chart-section-header">
            <span className="chart-section-title">Vote Distribution</span>
            <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
              {totalAll.toLocaleString()} total
            </span>
          </div>

          {/* Stacked overview bar */}
          <div className="overview-stacked-bar">
            <div className="overview-stacked-seg" style={{ width: `${pctSuccess}%`, backgroundColor: '#10b981' }} />
            <div className="overview-stacked-seg" style={{ width: `${pctSkipped}%`, backgroundColor: '#3f3f46' }} />
            <div className="overview-stacked-seg" style={{ width: `${pctFailed}%`,  backgroundColor: '#ef4444' }} />
          </div>

          {/* Individual rows */}
          {[
            { key: 'voted',   label: 'Voted',   count: totalSuccess, pct: pctSuccess, color: '#10b981' },
            { key: 'skipped', label: 'Skipped', count: totalSkipped, pct: pctSkipped, color: '#52525b' },
            { key: 'failed',  label: 'Failed',  count: totalFailed,  pct: pctFailed,  color: '#ef4444' },
          ].map(({ key, label, count, pct, color }) => (
            <div key={key} className="bar-row">
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', width: '72px', flexShrink: 0 }}>
                <div style={{ width: '7px', height: '7px', borderRadius: '50%', backgroundColor: color, flexShrink: 0 }} />
                <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>{label}</span>
              </div>
              <div className="bar-track">
                <div className="bar-fill" style={{ width: `${pct}%`, backgroundColor: color }} />
              </div>
              <div className="bar-count">{count.toLocaleString()}</div>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', minWidth: '38px', textAlign: 'right' }}>
                {pct.toFixed(1)}%
              </div>
            </div>
          ))}
        </div>

        {/* 7-Day Daily Trend */}
        <div className="card" style={{ margin: 0 }}>
          <div className="chart-section-header">
            <span className="chart-section-title">7-Day Vote Trend</span>
            <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>last 7 days</span>
          </div>
          <div className="daily-chart-container">
            <div className="daily-chart-bars">
              {last7Days.map(day => {
                const heightPx = maxDaily > 0 ? Math.max((day.total / maxDaily) * 64, day.total > 0 ? 4 : 0) : 0;
                const isToday  = day.date === localDateStr(new Date());
                return (
                  <div key={day.date} className="daily-col">
                    <div className="daily-col-count">{day.total > 0 ? day.total : ''}</div>
                    <div
                      className="daily-col-bar"
                      style={{
                        height: `${heightPx}px`,
                        backgroundColor: day.total > 0
                          ? (isToday ? '#60a5fa' : '#10b981')
                          : 'var(--bg-card-subtle)',
                        opacity: day.total > 0 ? 1 : 0.4,
                      }}
                    />
                  </div>
                );
              })}
            </div>
            <div className="daily-chart-labels">
              {last7Days.map(day => (
                <div key={day.date} className="daily-col-label">{day.label}</div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ── Per-Leader Performance ── */}
      {leaderStats.length > 0 && (
        <div className="card" style={{ marginBottom: 0 }}>
          <div className="chart-section-header">
            <span className="chart-section-title">Curation Leader Performance</span>
            <div className="chart-legend">
              {[
                { color: '#10b981', label: 'Voted' },
                { color: '#3f3f46', label: 'Skipped' },
                { color: '#ef4444', label: 'Failed' },
              ].map(({ color, label }) => (
                <div key={label} className="chart-legend-item">
                  <div className="chart-legend-dot" style={{ backgroundColor: color }} />
                  {label}
                </div>
              ))}
            </div>
          </div>

          {leaderStats.map(leader => {
            const pS = leader.total ? (leader.success / leader.total) * 100 : 0;
            const pK = leader.total ? (leader.skipped / leader.total) * 100 : 0;
            const pF = leader.total ? (leader.failed  / leader.total) * 100 : 0;
            const barW = leader.total ? (leader.total / maxLeaderTotal) * 100 : 0;

            return (
              <div key={leader.leader} className="bar-row" style={{ marginBottom: '0.85rem', alignItems: 'center' }}>
                <div className="bar-label">
                  <span style={{ color: 'var(--text-muted)', marginRight: '0.15rem' }}>@</span>
                  {leader.leader}
                </div>
                <div className="bar-track" style={{ height: '10px' }}>
                  <div className="bar-stacked" style={{ width: `${barW}%` }}>
                    <div className="bar-stacked-seg" style={{ width: `${pS}%`, backgroundColor: '#10b981' }} />
                    <div className="bar-stacked-seg" style={{ width: `${pK}%`, backgroundColor: '#3f3f46' }} />
                    <div className="bar-stacked-seg" style={{ width: `${pF}%`, backgroundColor: '#ef4444' }} />
                  </div>
                </div>
                <div className="bar-count">{leader.total.toLocaleString()}</div>
                <div style={{ fontSize: '0.72rem', color: '#10b981', minWidth: '38px', textAlign: 'right', fontWeight: '600' }}>
                  {pS.toFixed(0)}%
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Navigation Bar ──────────────────────────────────────────────────────────
const NAV_TABS = [
  { id: 'dashboard',       label: 'Dashboard',       icon: LayoutDashboard },
  { id: 'curation-trial',  label: 'Curation Trial',  icon: Layers },
  { id: 'auto-vote',       label: 'Auto Vote',       icon: Zap },
  { id: 'settings',        label: 'Settings',        icon: Cog },
];

function Navbar({ activePage, onNavigate, user, botAccount, status, onLogout }) {
  return (
    <nav className="navbar">
      <div className="navbar-inner">
        {/* Brand */}
        <div className="navbar-brand">Steem Curation Trial</div>

        {/* Tabs */}
        <div className="navbar-tabs">
          {NAV_TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              className={`nav-tab ${activePage === id ? 'active' : ''}`}
              onClick={() => onNavigate(id)}
            >
              <Icon size={15} />
              <span className="nav-tab-label">{label}</span>
            </button>
          ))}
        </div>

        {/* User + Sign Out */}
        <div className="navbar-user">
          <span className="badge badge-neutral" style={{ padding: '0.3rem 0.6rem', fontSize: '0.78rem' }}>
            @{user.username}
          </span>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={onLogout}
            title="Sign Out"
          >
            <LogOut size={13} />
            <span className="hide-mobile">Sign Out</span>
          </button>
        </div>
      </div>
    </nav>
  );
}

// ── Settings page: Auto Redeem + RPC Nodes ───────────────────────────────────
const REDEEM_INTERVAL_OPTIONS = [
  { h: 6, label: 'Every 6 hours' }, { h: 12, label: 'Every 12 hours' }, { h: 24, label: 'Daily' },
  { h: 48, label: 'Every 2 days' }, { h: 72, label: 'Every 3 days' }, { h: 168, label: 'Weekly' },
];
const sqlTimeAgo = (ts) => {
  if (!ts) return 'never';
  const s = Math.max(0, Math.floor((Date.now() - new Date(ts.replace(' ', 'T') + 'Z').getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
};
const vestsToSp = (vests, ratio) => {
  if (!vests) return '0.000 SP';
  const v = parseFloat(vests);
  if (!v || isNaN(v) || v <= 0) return '0.000 SP';
  const r = (typeof ratio === 'number' && ratio > 0) ? ratio : (201780397 / 325261996680);
  return `${(v * r).toFixed(3)} SP`;
};
const hasRewards = (p) => p && [p.steem, p.sbd, p.vests, p.sp].some(v => parseFloat(v) > 0);

function AutoRedeemCard({ username }) {
  const [settings, setSettings] = useState({ enabled: 0, interval_hours: 24, last_run: null });
  const [logs, setLogs]         = useState([]);
  const [pending, setPending]   = useState(null);
  const [busy, setBusy]         = useState(false);
  const [msg, setMsg]           = useState({ type: '', text: '' });

  const load = useCallback(async () => {
    try {
      const res = await api(`/settings/redeem/${username}`);
      if (res.success) { setSettings(res.settings); setLogs(res.logs); setPending(res.pending); }
    } catch { /* ignore */ }
  }, [username]);
  useEffect(() => { load(); }, [load]);

  const flash = (type, text) => { setMsg({ type, text }); setTimeout(() => setMsg({ type: '', text: '' }), 4000); };

  const save = async (patch) => {
    const next = { enabled: !!settings.enabled, intervalHours: settings.interval_hours, ...patch };
    const res = await post('/settings/redeem/save', { username, ...next });
    if (res.success) { setSettings(res.settings); flash('info', res.message); }
    else flash('error', res.error || 'Failed to save.');
  };

  const claim = async () => {
    setBusy(true);
    try {
      const res = await post('/settings/redeem/claim', { username });
      if (res.logs) { setLogs(res.logs); setSettings(res.settings); }
      if (res.success) {
        flash('info', res.status === 'CLAIMED' ? 'Rewards claimed!' : 'No pending rewards to claim.');
        load();
      } else flash('error', res.error || 'Claim failed.');
    } catch { flash('error', 'Claim failed.'); }
    finally { setBusy(false); }
  };

  const enabled = !!settings.enabled;
  const statusBadge = (s) => s === 'CLAIMED' ? 'badge-success' : s === 'FAILED' ? 'badge-danger' : 'badge-neutral';

  return (
    <div className="card" style={{ marginBottom: '1.5rem' }}>
      <div className="flex-header">
        <div>
          <h2 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}><Gift size={18} /> Auto Redeem</h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', margin: '0.35rem 0 0' }}>
            Automatically claim your pending STEEM, SBD and Steem Power rewards using the bot's posting authority.
          </p>
        </div>
        <span className={`badge ${enabled ? 'badge-success' : 'badge-neutral'}`}>{enabled ? 'Enabled' : 'Disabled'}</span>
      </div>

      {msg.text && <div className={`alert-box ${msg.type === 'error' ? 'alert-error' : 'alert-info'}`} style={{ marginTop: '1rem' }}>{msg.text}</div>}

      <div className="trail-item" style={{ display: 'block', marginTop: '1rem' }}>
        <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '0.4rem' }}>Pending rewards</div>
        <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap', fontWeight: 600 }}>
          {pending ? (<>
            <span title="Liquid STEEM">{pending.steem || '0.000 STEEM'}</span>
            <span title="Steem Dollars">{pending.sbd || '0.000 SBD'}</span>
            <span title={pending.vests ? `${pending.vests} (${pending.sp || vestsToSp(pending.vests)})` : 'Steem Power'}>
              {pending.sp || vestsToSp(pending.vests)}
            </span>
          </>) : <span style={{ color: 'var(--text-secondary)' }}>Unavailable</span>}
        </div>
      </div>

      <div className="grid-2col" style={{ marginTop: '1rem' }}>
        <div className="form-group">
          <label className="form-label" htmlFor="redeem-interval">Claim frequency</label>
          <select id="redeem-interval" className="form-input" value={settings.interval_hours}
            onChange={e => save({ intervalHours: parseInt(e.target.value, 10) })}>
            {REDEEM_INTERVAL_OPTIONS.map(o => <option key={o.h} value={o.h}>{o.label}</option>)}
          </select>
        </div>
        <div className="form-group">
          <label className="form-label">Last run</label>
          <div className="form-input" style={{ display: 'flex', alignItems: 'center' }}>{sqlTimeAgo(settings.last_run)}</div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
        <button className={`btn btn-sm ${enabled ? 'btn-secondary' : 'btn-primary'}`} onClick={() => save({ enabled: !enabled })}>
          {enabled ? <><Pause size={14} /> Disable Auto Redeem</> : <><Play size={14} /> Enable Auto Redeem</>}
        </button>
        <button className="btn btn-secondary btn-sm" onClick={claim} disabled={busy || !hasRewards(pending)}>
          <Gift size={14} /> {busy ? 'Claiming...' : 'Claim Now'}
        </button>
      </div>

      {logs.length > 0 && (
        <div style={{ marginTop: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Recent claims</div>
          {logs.slice(0, 8).map(l => (
            <div key={l.id} className="trail-item" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: '0.85rem' }}>
                  {l.status === 'CLAIMED' ? `${l.steem || '0.000 STEEM'} · ${l.sbd || '0.000 SBD'} · ${l.sp || vestsToSp(l.vests)}`
                    : l.status === 'FAILED' ? (l.error || 'Failed') : 'Nothing to claim'}
                </div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{sqlTimeAgo(l.timestamp)} · {l.source}</div>
              </div>
              <span className={`badge ${statusBadge(l.status)}`}>{l.status.replace(/_/g, ' ')}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function NodesCard() {
  const [info, setInfo] = useState(null);

  useEffect(() => {
    api('/settings/nodes').then(res => { if (res.success) setInfo(res); }).catch(() => {});
  }, []);

  return (
    <div className="card" style={{ marginBottom: '1.5rem' }}>
      <div className="flex-header">
        <div>
          <h2 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}><Server size={18} /> Connections</h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', margin: '0.35rem 0 0' }}>
            Steem blockchain network nodes and real-time streaming connections in use.
          </p>
        </div>
      </div>

      {/* Steem WebSocket Bridge */}
      {info?.bridge?.url && (
        <div className="trail-item" style={{ display: 'block', marginTop: '1rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem' }}>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Steem WebSocket Bridge (Block Stream)</div>
            <span className={`badge ${info.bridge.live ? 'badge-success' : 'badge-warning'}`}>
              {info.bridge.live ? 'Live Streaming' : 'Fallback to RPC'}
            </span>
          </div>
          <div style={{ fontWeight: 600, wordBreak: 'break-all', marginTop: '0.3rem' }}>{info.bridge.url}</div>
          <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginTop: '0.3rem' }}>
            {info.bridge.live
              ? 'Receiving new blocks in real-time with zero polling latency.'
              : 'Bridge offline or idle — streaming automatically through Steem RPC nodes.'}
          </div>
        </div>
      )}

      {/* Steem RPC Node */}
      {info && (
        <div className="trail-item" style={{ display: 'block', marginTop: '0.75rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem' }}>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Steem RPC Node (Transactions & Queries)</div>
            <span className="badge badge-success">Active</span>
          </div>
          <div style={{ fontWeight: 600, wordBreak: 'break-all', marginTop: '0.3rem' }}>{info.active}</div>
          <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginTop: '0.3rem' }}>
            {info.autoFailover
              ? 'Used for broadcasting votes, claims & queries. Automated node failover is enabled.'
              : 'Used for broadcasting votes, claims & queries. Pinned to this node.'}
          </div>
        </div>
      )}
    </div>
  );
}

function AccountStatusCard({
  user,
  steemProfile,
  vp,
  isAccountActive,
  hasBotAuth,
  onToggleStatus,
  onManageAuthority,
}) {
  return (
    <div className="card" style={{ marginBottom: '1.5rem' }}>
      <div className="flex-header" style={{ marginBottom: '0' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem' }}>
          <img
            src={`https://steemitimages.com/u/${user.username}/avatar`}
            onError={(e) => { e.target.src = 'https://steemitimages.com/u/steemit/avatar'; }}
            alt={user.username}
            style={{ width: '44px', height: '44px', borderRadius: '50%', border: '1px solid var(--border-subtle)' }}
          />
          <div>
            <div style={{ fontWeight: '700', fontSize: '1.05rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span>@{user.username}</span>
              <span className={`badge ${isAccountActive ? 'badge-success' : 'badge-warning'}`}>
                {isAccountActive ? 'Account Active' : 'Account Paused'}
              </span>
              {hasBotAuth ? (
                <span className="badge badge-success hide-mobile">Authority Granted</span>
              ) : (
                <span className="badge badge-danger hide-mobile">No Authority</span>
              )}
            </div>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
              Reputation {steemProfile?.reputation ?? 25} · Auth Mode: Posting Authority
            </div>
          </div>
        </div>

        <div className="header-actions" style={{ gap: '0.5rem' }}>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={onToggleStatus}
          >
            {isAccountActive ? <><Pause size={13} /> Pause All</> : <><Play size={13} /> Resume All</>}
          </button>
          {hasBotAuth ? (
            <button
              type="button"
              className="btn btn-danger btn-sm"
              onClick={() => onManageAuthority('revoke')}
            >
              Revoke Authority
            </button>
          ) : (
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => onManageAuthority('grant')}
            >
              <Shield size={13} /> Grant Authority
            </button>
          )}
        </div>
      </div>

      <div style={{ marginTop: '1.25rem' }}>
        <VotingPowerMeter vp={vp} />
      </div>
    </div>
  );
}

function SettingsPage({
  user,
  steemProfile,
  vp,
  isAccountActive,
  hasBotAuth,
  onToggleStatus,
  onManageAuthority
}) {
  return (
    <>
      <AccountStatusCard
        user={user}
        steemProfile={steemProfile}
        vp={vp}
        isAccountActive={isAccountActive}
        hasBotAuth={hasBotAuth}
        onToggleStatus={onToggleStatus}
        onManageAuthority={onManageAuthority}
      />
      <AutoRedeemCard username={user.username} />
      <NodesCard />
    </>
  );
}

// ── Placeholder page wrapper ─────────────────────────────────────────────────
const DELAY_OPTIONS = [0, 1, 2, 3, 5, 10, 15, 20, 30, 45, 60];
const fmtDelay = (m) => (m === 0 ? 'Immediately' : `${m} min`);
const avatarOf = (name) => `https://steemitimages.com/u/${name}/avatar`;
const fallbackAvatar = (e) => { e.target.src = 'https://steemitimages.com/u/steemit/avatar'; };

function AutoVotePage({ username }) {
  const [targets, setTargets]   = useState([]);
  const [logs, setLogs]         = useState([]);
  const [perAuthor, setPerAuthor] = useState([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState('');
  const [notice, setNotice]     = useState('');

  const [showAdd, setShowAdd]   = useState(false);
  const [author, setAuthor]     = useState('');
  const [weight, setWeight]     = useState(100);
  const [delay, setDelay]       = useState(0);
  const [minVp, setMinVp]       = useState(80);
  const [maxDaily, setMaxDaily] = useState(0);
  const [adding, setAdding]     = useState(false);

  // Real-time account verification state (mirrors AddTrailModal)
  const [avChecking, setAvChecking] = useState(false);
  const [avVerified, setAvVerified] = useState(null);
  const [avVerifyErr, setAvVerifyErr] = useState('');

  const [editId, setEditId]     = useState(null);
  const [eWeight, setEWeight]   = useState(100);
  const [eDelay, setEDelay]     = useState(0);
  const [eMinVp, setEMinVp]     = useState(80);
  const [eMaxDaily, setEMaxDaily] = useState(0);

  const [deleting, setDeleting] = useState(null);

  // Debounced Steem account lookup for the author field
  useEffect(() => {
    const clean = author.trim().toLowerCase();
    if (!clean || clean.length < 3) {
      setAvVerified(null);
      setAvVerifyErr('');
      return;
    }
    setAvChecking(true);
    setAvVerifyErr('');
    const timer = setTimeout(async () => {
      try {
        const res = await api(`/verify/${clean}`);
        if (res.success && res.profile) {
          setAvVerified(res.profile);
          setAvVerifyErr('');
        } else {
          setAvVerified(null);
          setAvVerifyErr(`Account @${clean} does not exist on Steem blockchain.`);
        }
      } catch (e) {
        setAvVerified(null);
        setAvVerifyErr('Failed to verify account on Steem.');
      } finally {
        setAvChecking(false);
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [author]);

  const load = useCallback(async () => {
    try {
      const res = await api(`/autovote/${username}`);
      if (res.success) {
        setTargets(res.targets || []);
        setLogs(res.logs || []);
        setPerAuthor(res.perAuthor || []);
      } else if (res.error) setError(res.error);
    } catch { setError('Failed to load auto-vote targets.'); }
    finally { setLoading(false); }
  }, [username]);

  useEffect(() => {
    load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, [load]);

  const flash = (msg) => { setNotice(msg); setTimeout(() => setNotice(''), 3500); };

  const handleAdd = async (e) => {
    e.preventDefault();
    if (!avVerified) {
      setAvVerifyErr('Please enter a valid Steem account name.');
      return;
    }
    setAdding(true); setError('');
    try {
      const res = await post('/autovote/add', {
        username, targetAuthor: avVerified.name,
        weight: parseInt(weight, 10), delay: parseInt(delay, 10),
        minVp: parseInt(minVp, 10), maxDailyVotes: parseInt(maxDaily, 10) || 0,
      });
      if (!res.success) throw new Error(res.error || 'Failed to add author.');
      setTargets(res.targets); setLogs(res.logs || logs); setPerAuthor(res.perAuthor || perAuthor);
      setAuthor(''); setAvVerified(null); setShowAdd(false); flash(res.message);
    } catch (err) { setError(err.message); }
    finally { setAdding(false); }
  };

  const mutate = async (path, body, okMsg) => {
    setError('');
    try {
      const res = await post(path, { username, ...body });
      if (!res.success) throw new Error(res.error || 'Request failed.');
      setTargets(res.targets);
      if (okMsg) flash(okMsg);
      return true;
    } catch (err) { setError(err.message); return false; }
  };

  const startEdit = (t) => {
    setEditId(t.id); setEWeight(t.weight); setEDelay(t.delay);
    setEMinVp(t.min_vp); setEMaxDaily(t.max_daily_votes);
  };

  const saveEdit = async (id) => {
    const ok = await mutate('/autovote/update', {
      id, weight: parseInt(eWeight, 10), delay: parseInt(eDelay, 10),
      minVp: parseInt(eMinVp, 10), maxDailyVotes: parseInt(eMaxDaily, 10) || 0,
    }, 'Target updated');
    if (ok) setEditId(null);
  };

  const statsFor = (a) => perAuthor.find(p => p.author === a) || { total: 0, success: 0 };
  const timeAgo = (ts) => {
    const d = new Date(ts.replace(' ', 'T') + 'Z');
    const s = Math.max(0, Math.floor((Date.now() - d.getTime()) / 1000));
    if (s < 60) return `${s}s ago`;
    if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
    return `${Math.floor(s / 86400)}d ago`;
  };
  const badgeFor = (s) => s === 'SUCCESS' ? 'badge-success' : s === 'FAILED' ? 'badge-danger' : 'badge-warning';

  return (
    <div className="card" style={{ marginBottom: '1.5rem' }}>
      <div className="flex-header">
        <div>
          <h2 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Zap size={18} /> Auto Vote Targets ({targets.length})
          </h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', margin: '0.35rem 0 0' }}>
            Vote on any author's new posts automatically, as soon as they publish.
          </p>
        </div>
        <div className="header-actions">
          <button className="btn btn-primary btn-sm" onClick={() => { setShowAdd(v => !v); if (showAdd) { setAuthor(''); setAvVerified(null); setAvVerifyErr(''); } }}>
            {showAdd ? <X size={14} /> : <Plus size={14} />} {showAdd ? 'Cancel' : 'Add Author'}
          </button>
        </div>
      </div>

      {error && <div className="alert-box alert-error" style={{ marginTop: '1rem' }}>{error}</div>}
      {notice && <div className="alert-box alert-info" style={{ marginTop: '1rem' }}>{notice}</div>}

      {showAdd && (
        <form onSubmit={handleAdd} className="trail-item" style={{ marginTop: '1rem', display: 'block' }}>
          <div className="form-group">
            <label className="form-label" htmlFor="av-author">
              <span>Author to auto-vote</span>
              {avChecking && <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Verifying on Steem...</span>}
            </label>
            <input id="av-author" className="form-input" placeholder="e.g. dhaka.witness"
              value={author} onChange={e => setAuthor(e.target.value)}
              autoComplete="off" spellCheck="false" required />
          </div>

          {/* Account Verification Feedback Card */}
          {avVerified && (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '0.75rem 1rem',
              backgroundColor: 'var(--bg-input)',
              border: '1px solid rgba(34, 197, 94, 0.3)',
              borderRadius: 'var(--radius-sm)',
              marginBottom: '1rem'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <img
                  src={`https://steemitimages.com/u/${avVerified.name}/avatar`}
                  onError={(e) => { e.target.src = 'https://steemitimages.com/u/steemit/avatar'; }}
                  alt={avVerified.name}
                  style={{ width: '32px', height: '32px', borderRadius: '50%' }}
                />
                <div>
                  <div style={{ fontWeight: '600', fontSize: '0.9rem' }}>@{avVerified.name}</div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                    Reputation {avVerified.reputation} · {avVerified.votingPower}% VP
                  </div>
                </div>
              </div>
              <span className="badge badge-success">Verified</span>
            </div>
          )}

          {avVerifyErr && (
            <div className="alert-box alert-error" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem' }}>
              <AlertCircle size={14} />
              <span>{avVerifyErr}</span>
            </div>
          )}

          <div className="form-group">
            <label className="form-label" htmlFor="av-weight">
              <span>Vote Weight</span><span>{weight}%</span>
            </label>
            <input id="av-weight" type="range" min="1" max="100" value={weight}
              onChange={e => setWeight(e.target.value)} style={{ width: '100%' }} />
          </div>
          <div className="grid-2col">
            <div className="form-group">
              <label className="form-label" htmlFor="av-delay">Vote Delay</label>
              <select id="av-delay" className="form-input" value={delay} onChange={e => setDelay(e.target.value)}>
                {DELAY_OPTIONS.map(m => <option key={m} value={m}>{fmtDelay(m)}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="av-minvp">Min Voting Power (%)</label>
              <input id="av-minvp" type="number" min="10" max="99" className="form-input"
                value={minVp} onChange={e => setMinVp(e.target.value)} />
            </div>
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="av-max">Max votes per day (0 = unlimited)</label>
            <input id="av-max" type="number" min="0" className="form-input"
              value={maxDaily} onChange={e => setMaxDaily(e.target.value)} />
          </div>
          <button type="submit" className="btn btn-primary btn-full" disabled={adding || !avVerified}>
            {adding ? 'Verifying & adding...' : 'Start Auto Voting'}
          </button>
        </form>
      )}

      <div style={{ marginTop: '1rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        {loading ? (
          <p style={{ color: 'var(--text-secondary)' }}>Loading...</p>
        ) : targets.length === 0 ? (
          <p style={{ color: 'var(--text-secondary)', textAlign: 'center', padding: '1.5rem 0' }}>
            No targeted authors yet. Add an author to vote on their new posts automatically.
          </p>
        ) : targets.map(t => {
          const st = statsFor(t.target_author);
          const active = t.status === 'active';
          return (
            <div key={t.id} className="trail-item" style={{ display: 'block' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                  <img src={avatarOf(t.target_author)} onError={fallbackAvatar} alt={t.target_author}
                    style={{ width: 36, height: 36, borderRadius: '50%' }} />
                  <div>
                    <a href={`https://steemit.com/@${t.target_author}`} target="_blank" rel="noreferrer"
                      style={{ color: 'var(--text-primary)', fontWeight: 600, textDecoration: 'none' }}>
                      @{t.target_author} <ExternalLink size={11} />
                    </a>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                      {t.weight}% weight · {fmtDelay(t.delay)} · min VP {t.min_vp}%
                      {t.max_daily_votes > 0 ? ` · max ${t.max_daily_votes}/day` : ''}
                      {' · '}{st.success} voted
                    </div>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  <span className={`badge ${active ? 'badge-success' : 'badge-neutral'}`}>{active ? 'Active' : 'Paused'}</span>
                  <button className="btn btn-secondary btn-sm" title={active ? 'Pause' : 'Resume'}
                    onClick={() => mutate('/autovote/update', { id: t.id, status: active ? 'paused' : 'active' })}>
                    {active ? <Pause size={14} /> : <Play size={14} />}
                  </button>
                  <button className="btn btn-secondary btn-sm" title="Edit"
                    onClick={() => editId === t.id ? setEditId(null) : startEdit(t)}><Sliders size={14} /></button>
                  <button className="btn btn-danger btn-sm" title="Remove" onClick={() => setDeleting(t)}><Trash2 size={14} /></button>
                </div>
              </div>

              {editId === t.id && (
                <div style={{ marginTop: '1rem' }}>
                  <div className="form-group">
                    <label className="form-label"><span>Vote Weight</span><span>{eWeight}%</span></label>
                    <input type="range" min="1" max="100" value={eWeight}
                      onChange={e => setEWeight(e.target.value)} style={{ width: '100%' }} />
                  </div>
                  <div className="grid-2col">
                    <div className="form-group">
                      <label className="form-label">Vote Delay</label>
                      <select className="form-input" value={eDelay} onChange={e => setEDelay(e.target.value)}>
                        {DELAY_OPTIONS.map(m => <option key={m} value={m}>{fmtDelay(m)}</option>)}
                      </select>
                    </div>
                    <div className="form-group">
                      <label className="form-label">Min VP (%)</label>
                      <input type="number" min="10" max="99" className="form-input"
                        value={eMinVp} onChange={e => setEMinVp(e.target.value)} />
                    </div>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Max votes per day (0 = unlimited)</label>
                    <input type="number" min="0" className="form-input"
                      value={eMaxDaily} onChange={e => setEMaxDaily(e.target.value)} />
                  </div>
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <button className="btn btn-primary btn-sm" onClick={() => saveEdit(t.id)}><Check size={14} /> Save</button>
                    <button className="btn btn-secondary btn-sm" onClick={() => setEditId(null)}>Cancel</button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <h3 style={{ margin: '1.75rem 0 0.75rem', fontSize: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        <Activity size={16} /> Recent Auto Votes
      </h3>
      {logs.length === 0 ? (
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
          No auto-votes yet. They appear here when a targeted author publishes a new post.
        </p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {logs.map(l => (
            <div key={l.id} className="trail-item" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
              <div style={{ minWidth: 0 }}>
                <a href={`https://steemit.com/@${l.author}/${l.permlink}`} target="_blank" rel="noreferrer"
                  style={{ color: 'var(--text-primary)', textDecoration: 'none', fontWeight: 500 }}>
                  @{l.author}/{l.permlink.length > 32 ? l.permlink.slice(0, 32) + '…' : l.permlink}
                </a>
                <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                  {l.weight}% · {timeAgo(l.timestamp)}{l.error ? ` · ${l.error}` : ''}
                </div>
              </div>
              <span className={`badge ${badgeFor(l.status)}`}>{l.status.replace('SKIPPED_', 'SKIPPED ')}</span>
            </div>
          ))}
        </div>
      )}

      <ConfirmModal
        isOpen={!!deleting}
        title="Remove Target Author"
        message={deleting ? `Stop auto-voting @${deleting.target_author}'s new posts?` : ''}
        confirmText="Remove"
        isProcessing={false}
        onCancel={() => setDeleting(null)}
        onConfirm={async () => {
          await mutate('/autovote/remove', { id: deleting.id }, 'Target removed');
          setDeleting(null);
        }}
      />
    </div>
  );
}

function ComingSoonPage({ icon: Icon, title, description }) {
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: '40vh',
      gap: '1rem',
      color: 'var(--text-secondary)',
      textAlign: 'center',
      padding: '3rem 1rem',
    }}>
      <div style={{
        width: '56px',
        height: '56px',
        borderRadius: '14px',
        backgroundColor: 'var(--bg-card)',
        border: '1px solid var(--border-subtle)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}>
        <Icon size={26} color="var(--text-secondary)" />
      </div>
      <div>
        <div style={{ fontSize: '1.1rem', fontWeight: '700', color: 'var(--text-primary)', marginBottom: '0.4rem' }}>{title}</div>
        <div style={{ fontSize: '0.875rem', maxWidth: '360px', lineHeight: '1.6' }}>{description}</div>
      </div>
      <span className="badge badge-neutral" style={{ marginTop: '0.5rem' }}>Coming Soon</span>
    </div>
  );
}

// ── Dashboard View ──────────────────────────────────────────────────────────
function DashboardView({ user, steemProfile, trails = [], logs = [], status, wsState, botAccount, onRefresh, onLogout }) {
  const [activePage, setActivePage] = useState('dashboard');
  const [actionError, setActionError] = useState('');
  const [actionSuccess, setActionSuccess] = useState('');

  // Modals
  const [showAddModal, setShowAddModal] = useState(false);
  const [trailToDelete, setTrailToDelete] = useState(null);
  const [showAuthorityModal, setShowAuthorityModal] = useState(null); // 'grant' | 'revoke' | null
  const [modalProcessing, setModalProcessing] = useState(false);

  // Edit inline trail state
  const [editingTrailId, setEditingTrailId] = useState(null);
  const [editWeight, setEditWeight] = useState(100);
  const [editDelay, setEditDelay] = useState(0);
  const [editMinVp, setEditMinVp] = useState(80);
  const [editAllowUpvotes, setEditAllowUpvotes] = useState(true);
  const [editAllowDownvotes, setEditAllowDownvotes] = useState(true);
  const [editWhitelist, setEditWhitelist] = useState('');
  const [editBlacklist, setEditBlacklist] = useState('');
  const [editMaxDailyVotes, setEditMaxDailyVotes] = useState(0);

  // Pagination & Refresh state for Recent Vote Activity
  const [currentPage, setCurrentPage] = useState(1);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const logsPerPage = 10;

  const totalLogs = logs.length;
  const totalPages = Math.max(1, Math.ceil(totalLogs / logsPerPage));
  const validPage = Math.min(currentPage, totalPages);
  const startIndex = (validPage - 1) * logsPerPage;
  const currentLogs = logs.slice(startIndex, startIndex + logsPerPage);

  const handleRefreshClick = async () => {
    setIsRefreshing(true);
    try {
      await onRefresh();
    } catch (e) {
      console.error(e);
    } finally {
      setTimeout(() => setIsRefreshing(false), 500);
    }
  };

  const vp = steemProfile?.votingPower || 95;
  const isAccountActive = user?.status === 'active';

  // Check on-chain whether bot account has posting authority
  const hasBotAuth = (steemProfile?.posting?.account_auths ?? []).some(
    ([a]) => a.toLowerCase() === botAccount.toLowerCase()
  );

  const showNotification = (msg, isErr = false) => {
    if (isErr) {
      setActionError(msg);
      setTimeout(() => setActionError(''), 4000);
    } else {
      setActionSuccess(msg);
      setTimeout(() => setActionSuccess(''), 3000);
    }
  };

  const handleConfirmGrantKeychain = async () => {
    if (!hasKeychain()) {
      showNotification('Steem Keychain extension is required to use this method.', true);
      return;
    }

    setModalProcessing(true);
    setActionError('');

    try {
      const freshCheck = await api(`/user/${user.username}`);
      const currentProfile = freshCheck.steemProfile || steemProfile;

      const grantRes = await keychainGrantAuthority({
        username: user.username,
        botAccount,
        currentPosting: currentProfile.posting,
        memoKey: currentProfile.memoKey,
        jsonMetadata: currentProfile.jsonMetadata,
      });

      if (grantRes.ok) {
        showNotification(`Posting authority granted to @${botAccount}. Trail voting is now active.`);
        setShowAuthorityModal(null);
        onRefresh();
      } else {
        showNotification(grantRes.error || 'Failed to grant authority via Keychain.', true);
      }
    } catch (err) {
      showNotification(err.message || 'Authority grant failed.', true);
    } finally {
      setModalProcessing(false);
    }
  };

  const handleConfirmGrantActiveKey = async (activeKey, setError) => {
    setModalProcessing(true);
    try {
      const freshCheck = await api(`/user/${user.username}`);
      const currentProfile = freshCheck.steemProfile || steemProfile;
      if (!currentProfile) throw new Error('Could not fetch account details from blockchain.');

      const existingAuths = (currentProfile.posting?.account_auths ?? [])
        .filter(([a]) => a.toLowerCase() !== botAccount.toLowerCase());

      const newPosting = {
        weight_threshold: currentProfile.posting?.weight_threshold || 1,
        account_auths: [...existingAuths, [botAccount, 1]].sort((a, b) => a[0].localeCompare(b[0])),
        key_auths: currentProfile.posting?.key_auths || [],
      };

      await broadcastAccountUpdate(
        activeKey,
        user.username,
        newPosting,
        currentProfile.memoKey,
        currentProfile.jsonMetadata || ''
      );

      showNotification(`Posting authority granted to @${botAccount}. Trail voting is now active.`);
      setShowAuthorityModal(null);
      onRefresh();
    } catch (err) {
      const errorMsg = err.message || String(err);
      if (errorMsg.includes('missing required active authority') || errorMsg.includes('Invalid WIF')) {
        setError('Invalid Private Active Key provided. Please check your key and try again.');
      } else {
        setError(errorMsg || 'Failed to grant authority with Active Key.');
      }
    } finally {
      setModalProcessing(false);
    }
  };

  const handleAddTrail = async ({
    trailAccount,
    weight,
    delay,
    minVp,
    allowUpvotes,
    allowDownvotes,
    maxDailyVotes = 0,
    whitelist = '',
    blacklist = ''
  }) => {
    const res = await post('/trails/add', {
      username: user.username,
      trailAccount,
      weight,
      delay,
      minVp,
      allowUpvotes,
      allowDownvotes,
      maxDailyVotes,
      whitelist,
      blacklist
    });

    if (res.success) {
      showNotification(`Now following @${trailAccount}`);
      onRefresh();
    } else {
      throw new Error(res.error || 'Failed to add trail.');
    }
  };

  const handleToggleTrailStatus = async (trail) => {
    const nextStatus = trail.status === 'active' ? 'paused' : 'active';
    try {
      const res = await post('/trails/toggle', {
        id: trail.id,
        username: user.username,
        status: nextStatus
      });
      if (res.success) onRefresh();
    } catch (e) {
      showNotification('Failed to toggle trail status.', true);
    }
  };

  const startEditTrail = (trail) => {
    setEditingTrailId(trail.id);
    setEditWeight(trail.weight);
    setEditDelay(trail.delay);
    setEditMinVp(trail.min_vp);
    setEditAllowUpvotes(trail.allow_upvotes === 1);
    setEditAllowDownvotes(trail.allow_downvotes === 1);
    setEditWhitelist(trail.whitelist || '');
    setEditBlacklist(trail.blacklist || '');
    setEditMaxDailyVotes(trail.max_daily_votes || 0);
  };

  const handleSaveEditTrail = async (trailId) => {
    try {
      const res = await post('/trails/update', {
        id: trailId,
        username: user.username,
        weight: parseInt(editWeight, 10),
        delay: parseInt(editDelay, 10),
        minVp: parseInt(editMinVp, 10),
        allowUpvotes: editAllowUpvotes,
        allowDownvotes: editAllowDownvotes,
        maxDailyVotes: parseInt(editMaxDailyVotes, 10) || 0,
        whitelist: editWhitelist,
        blacklist: editBlacklist
      });
      if (res.success) {
        setEditingTrailId(null);
        showNotification('Trail settings updated.');
        onRefresh();
      } else {
        showNotification(res.error || 'Failed to update trail.', true);
      }
    } catch (e) {
      showNotification('Network error updating trail.', true);
    }
  };

  const handleConfirmDeleteTrail = async () => {
    if (!trailToDelete) return;
    setModalProcessing(true);
    try {
      const res = await post('/trails/remove', {
        id: trailToDelete.id,
        username: user.username
      });
      if (res.success) {
        setTrailToDelete(null);
        showNotification(`Unfollowed @${trailToDelete.trail_account}`);
        onRefresh();
      } else {
        showNotification(res.error || 'Failed to remove trail.', true);
      }
    } catch (e) {
      showNotification('Network error.', true);
    } finally {
      setModalProcessing(false);
    }
  };

  const handleToggleGlobalStatus = async () => {
    const next = isAccountActive ? 'paused' : 'active';
    try {
      const res = await post('/toggle-status', { username: user.username, status: next });
      if (res.success) onRefresh();
    } catch (e) {
      showNotification('Failed to toggle status.', true);
    }
  };

  const handleConfirmRevokeKeychain = async () => {
    if (!hasKeychain()) {
      showNotification('Steem Keychain extension is required to use this method.', true);
      return;
    }

    setModalProcessing(true);
    setActionError('');

    try {
      const freshCheck = await api(`/user/${user.username}`);
      const currentProfile = freshCheck.steemProfile || steemProfile;

      const revokeRes = await keychainRevokeAuthority({
        username: user.username,
        botAccount,
        currentPosting: currentProfile.posting,
        memoKey: currentProfile.memoKey,
        jsonMetadata: currentProfile.jsonMetadata,
      });

      if (revokeRes.ok) {
        showNotification(`Posting authority revoked from @${botAccount}.`);
        setShowAuthorityModal(null);
        onRefresh();
      } else {
        showNotification(revokeRes.error || 'Failed to revoke authority via Keychain.', true);
      }
    } catch (err) {
      showNotification(err.message || 'Revoke operation failed.', true);
    } finally {
      setModalProcessing(false);
    }
  };

  const handleConfirmRevokeActiveKey = async (activeKey, setError) => {
    setModalProcessing(true);
    try {
      const freshCheck = await api(`/user/${user.username}`);
      const currentProfile = freshCheck.steemProfile || steemProfile;
      if (!currentProfile) throw new Error('Could not fetch account details from blockchain.');

      const newPosting = {
        weight_threshold: currentProfile.posting?.weight_threshold || 1,
        account_auths: (currentProfile.posting?.account_auths ?? [])
          .filter(([a]) => a.toLowerCase() !== botAccount.toLowerCase())
          .sort((a, b) => a[0].localeCompare(b[0])),
        key_auths: currentProfile.posting?.key_auths || [],
      };

      await broadcastAccountUpdate(
        activeKey,
        user.username,
        newPosting,
        currentProfile.memoKey,
        currentProfile.jsonMetadata || ''
      );

      showNotification(`Posting authority revoked from @${botAccount}.`);
      setShowAuthorityModal(null);
      onRefresh();
    } catch (err) {
      const errorMsg = err.message || String(err);
      if (errorMsg.includes('missing required active authority') || errorMsg.includes('Invalid WIF')) {
        setError('Invalid Private Active Key provided. Please check your key and try again.');
      } else {
        setError(errorMsg || 'Failed to revoke authority with Active Key.');
      }
    } finally {
      setModalProcessing(false);
    }
  };

  return (
    <div className="container-app">
      {/* Navigation Bar */}
      <Navbar
        activePage={activePage}
        onNavigate={setActivePage}
        user={user}
        botAccount={botAccount}
        status={status}
        onLogout={onLogout}
      />

      {/* Block sync info strip */}
      <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '1.25rem', marginTop: '-0.5rem' }}>
        Block #{status?.syncedBlock?.toLocaleString() ?? '…'} · Bot: @{botAccount}
      </div>

      {actionError && (
        <div className="alert-box alert-error" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem' }}>
          <AlertCircle size={16} />
          <span>{actionError}</span>
        </div>
      )}

      {actionSuccess && (
        <div className="alert-box alert-info" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--color-success)', marginBottom: '1rem' }}>
          <Check size={16} />
          <span>{actionSuccess}</span>
        </div>
      )}

      {/* ── Page: Curation Trial ─────────────────────────────────────── */}
      {activePage === 'curation-trial' && (<>

      {/* Followed Curation Trails Section */}
      <div className="card" style={{ marginBottom: '1.5rem' }}>
        <div className="flex-header" style={{ marginBottom: '1.25rem' }}>
          <div>
            <h2 style={{ fontSize: '1.05rem', fontWeight: '700', margin: 0 }}>
              Followed Curation Trails ({trails.length})
            </h2>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', margin: 0 }}>
              Accounts you are currently auto-voting with
            </p>
          </div>

          <div className="header-actions">
            <button
              type="button"
              className="btn btn-primary btn-sm btn-full"
              onClick={() => setShowAddModal(true)}
            >
              <Plus size={14} />
              <span>Follow Account</span>
            </button>
          </div>
        </div>

        {trails.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '2.5rem 1rem', color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
            <p style={{ margin: '0 0 1rem 0' }}>You are not following any curation trails yet.</p>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => setShowAddModal(true)}
            >
              <Plus size={14} />
              <span>Add Your First Trail Account</span>
            </button>
          </div>
        ) : (
          <div>
            {trails.map((trail) => {
              const isEditing = editingTrailId === trail.id;

              return (
                <div key={trail.id} className="trail-item">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem', marginBottom: isEditing ? '1rem' : '0' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                      <img
                        src={`https://steemitimages.com/u/${trail.trail_account}/avatar`}
                        onError={(e) => { e.target.src = 'https://steemitimages.com/u/steemit/avatar'; }}
                        alt={trail.trail_account}
                        style={{ width: '36px', height: '36px', borderRadius: '50%', border: '1px solid var(--border-subtle)' }}
                      />
                      <div>
                        <div style={{ fontWeight: '600', fontSize: '0.95rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                          <span>@{trail.trail_account}</span>
                          <span className={`badge ${trail.status === 'active' ? 'badge-success' : 'badge-warning'}`}>
                            {trail.status === 'active' ? 'Active' : 'Paused'}
                          </span>
                        </div>
                        {!isEditing && (
                          <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '0.2rem' }}>
                            Weight: <strong style={{ color: 'var(--text-primary)' }}>{trail.weight}%</strong> · Delay: <strong style={{ color: 'var(--text-primary)' }}>{trail.delay}m</strong> · Min VP: <strong style={{ color: 'var(--text-primary)' }}>{trail.min_vp}%</strong> · Upvotes: <strong style={{ color: trail.allow_upvotes ? 'var(--primary-cyan)' : 'var(--text-secondary)' }}>{trail.allow_upvotes ? 'On' : 'Off'}</strong> · Downvotes: <strong style={{ color: trail.allow_downvotes ? 'var(--accent-rose)' : 'var(--text-secondary)' }}>{trail.allow_downvotes ? 'On' : 'Off'}</strong>
                            {trail.max_daily_votes > 0 ? <> · Max Votes/Day: <strong style={{ color: 'var(--text-primary)' }}>{trail.max_daily_votes}</strong></> : null}
                            {trail.whitelist ? <> · Whitelist: <strong style={{ color: 'var(--primary-cyan)' }}>{trail.whitelist.split(',').length} author(s)</strong></> : null}
                            {trail.blacklist ? <> · Blacklist: <strong style={{ color: 'var(--accent-rose)' }}>{trail.blacklist.split(',').length} author(s)</strong></> : null}
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="header-actions" style={{ alignItems: 'center', gap: '0.5rem' }}>
                      {!isEditing ? (
                        <>
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            onClick={() => handleToggleTrailStatus(trail)}
                            title={trail.status === 'active' ? 'Pause Trail' : 'Resume Trail'}
                          >
                            {trail.status === 'active' ? <Pause size={13} /> : <Play size={13} />}
                          </button>
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            onClick={() => startEditTrail(trail)}
                            title="Edit Settings"
                          >
                            <Sliders size={13} />
                          </button>
                          <button
                            type="button"
                            className="btn btn-danger btn-sm"
                            onClick={() => setTrailToDelete(trail)}
                            title="Unfollow Trail"
                          >
                            <Trash2 size={13} />
                          </button>
                        </>
                      ) : (
                        <div className="header-actions" style={{ gap: '0.5rem' }}>
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm btn-full"
                            onClick={() => setEditingTrailId(null)}
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            className="btn btn-primary btn-sm btn-full"
                            onClick={() => handleSaveEditTrail(trail.id)}
                          >
                            Save
                          </button>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Inline Edit Form */}
                  {isEditing && (
                    <div style={{ paddingTop: '0.75rem', borderTop: '1px solid var(--border-subtle)' }}>
                      <div className="grid-2col" style={{ gap: '0.75rem' }}>
                        <div className="form-group" style={{ margin: 0 }}>
                          <div className="form-label" style={{ fontSize: '0.75rem' }}>
                            <span>Weight Scale</span>
                            <strong>{editWeight}%</strong>
                          </div>
                          <input
                            type="range"
                            min="1"
                            max="100"
                            value={editWeight}
                            onChange={(e) => setEditWeight(e.target.value)}
                          />
                        </div>

                        <div className="form-group" style={{ margin: 0 }}>
                          <div className="form-label" style={{ fontSize: '0.75rem' }}>
                            <span>Min VP Guard</span>
                            <strong>{editMinVp}%</strong>
                          </div>
                          <input
                            type="range"
                            min="50"
                            max="95"
                            value={editMinVp}
                            onChange={(e) => setEditMinVp(e.target.value)}
                          />
                        </div>

                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '1rem' }}>
                          <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-start', gap: '0.4rem', cursor: 'pointer', fontSize: '0.8rem', margin: 0, color: 'var(--text-secondary)' }}>
                            <input
                              type="checkbox"
                              checked={editAllowUpvotes}
                              onChange={(e) => setEditAllowUpvotes(e.target.checked)}
                              style={{ width: '14px', height: '14px', accentColor: 'var(--primary-cyan)' }}
                            />
                            <span>Upvotes</span>
                          </label>
                          <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-start', gap: '0.4rem', cursor: 'pointer', fontSize: '0.8rem', margin: 0, color: 'var(--text-secondary)' }}>
                            <input
                              type="checkbox"
                              checked={editAllowDownvotes}
                              onChange={(e) => setEditAllowDownvotes(e.target.checked)}
                              style={{ width: '14px', height: '14px', accentColor: 'var(--accent-rose)' }}
                            />
                            <span>Downvotes</span>
                          </label>
                        </div>
                      </div>

                      <div className="form-group" style={{ marginTop: '0.5rem', marginBottom: 0 }}>
                        <label className="form-label" style={{ fontSize: '0.75rem' }}>Vote Delay</label>
                        <select
                          className="form-input"
                          style={{ padding: '0.4rem 0.65rem', fontSize: '0.85rem' }}
                          value={editDelay}
                          onChange={(e) => setEditDelay(e.target.value)}
                        >
                          <option value={0}>Instant (0 minutes)</option>
                          <option value={1}>1 minute</option>
                          <option value={3}>3 minutes</option>
                          <option value={5}>5 minutes</option>
                          <option value={10}>10 minutes</option>
                          <option value={15}>15 minutes</option>
                        </select>
                      </div>

                      <div className="grid-2col" style={{ gap: '0.75rem', marginTop: '0.75rem', marginBottom: '0.5rem' }}>
                        <div className="form-group" style={{ margin: 0 }}>
                          <label className="form-label" style={{ fontSize: '0.75rem' }}>Max Daily Votes (0 = ∞)</label>
                          <input
                            type="number"
                            min="0"
                            className="form-input"
                            style={{ padding: '0.4rem 0.6rem', fontSize: '0.8rem' }}
                            value={editMaxDailyVotes}
                            onChange={(e) => setEditMaxDailyVotes(e.target.value)}
                          />
                        </div>
                        <div className="form-group" style={{ margin: 0 }}>
                          <label className="form-label" style={{ fontSize: '0.75rem' }}>Whitelist (csv)</label>
                          <input
                            type="text"
                            className="form-input"
                            style={{ padding: '0.4rem 0.6rem', fontSize: '0.8rem' }}
                            value={editWhitelist}
                            onChange={(e) => setEditWhitelist(e.target.value)}
                            placeholder="e.g. bob"
                          />
                        </div>
                      </div>
                      <div className="form-group" style={{ margin: 0, marginTop: '0.5rem' }}>
                          <label className="form-label" style={{ fontSize: '0.75rem' }}>Blacklist (comma-separated)</label>
                          <input
                            type="text"
                            className="form-input"
                            style={{ padding: '0.4rem 0.6rem', fontSize: '0.8rem' }}
                            value={editBlacklist}
                            onChange={(e) => setEditBlacklist(e.target.value)}
                            placeholder="e.g. spammer"
                          />
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
      </>)}

      {/* ── Page: Auto Vote ──────────────────────────────────────────── */}
      {activePage === 'auto-vote' && <AutoVotePage username={user.username} />}

      {/* ── Page: Settings ───────────────────────────────────────────── */}
      {activePage === 'settings' && (
        <SettingsPage
          user={user}
          steemProfile={steemProfile}
          vp={vp}
          isAccountActive={isAccountActive}
          hasBotAuth={hasBotAuth}
          onToggleStatus={handleToggleGlobalStatus}
          onManageAuthority={setShowAuthorityModal}
        />
      )}

      {/* ── Page: Dashboard ──────────────────────────────────────────── */}
      {activePage === 'dashboard' && (<>

      {/* Authority Warning Banner */}
      {!hasBotAuth && (
        <div className="alert-box alert-error" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.75rem', marginBottom: '1rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <AlertCircle size={16} />
            <div>
              <div style={{ fontWeight: '600' }}>Posting Authority Not Granted</div>
              <div style={{ fontSize: '0.8rem', opacity: 0.85, marginTop: '0.15rem' }}>
                @{botAccount} does not have posting authority on @{user.username}. Trail voting cannot function without it.
              </div>
            </div>
          </div>
          
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() => setShowAuthorityModal('grant')}
            style={{ flexShrink: 0 }}
          >
            <Shield size={13} />
            <span>Grant Authority</span>
          </button>
        </div>
      )}

      {/* ── Dashboard Stats ── */}
      <DashboardStats logs={logs} status={status} trails={trails} username={user.username} />

      {/* Live Vote Activity Logs */}
      <div className="card">
        <div className="flex-header" style={{ marginBottom: '1rem' }}>
          <div>
            <h2 style={{ fontSize: '1.05rem', fontWeight: '700', margin: 0 }}>Recent Vote Activity</h2>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', margin: 0 }}>
              Live votes processed by the curation engine
            </p>
          </div>

          <div className="header-actions" style={{ gap: '0.5rem' }}>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={handleRefreshClick}
              disabled={isRefreshing}
              title="Refresh Logs"
            >
              <RefreshCw size={13} className={isRefreshing ? 'spin-active' : ''} />
              <span>{isRefreshing ? 'Refreshing...' : 'Refresh'}</span>
            </button>
          </div>
        </div>

        {totalLogs === 0 ? (
          <div style={{ textAlign: 'center', padding: '2rem 1rem', color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
            No vote activity recorded yet. Votes from your followed trail accounts will appear here automatically.
          </div>
        ) : (
          <>
            <div style={{ overflowX: 'auto' }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Trail Leader</th>
                    <th>Target Post</th>
                    <th>Voter</th>
                    <th>Weight</th>
                    <th>Status</th>
                    <th>Time</th>
                  </tr>
                </thead>
                <tbody>
                  {currentLogs.map((log) => (
                    <tr key={log.id}>
                      <td>
                        <span style={{ fontWeight: '600' }}>@{log.leader}</span>
                      </td>
                      <td>
                        <a
                          href={`https://steemit.com/@${log.author}/${log.permlink}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{ color: 'var(--color-primary)', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}
                        >
                          @{log.author}/{log.permlink.length > 20 ? log.permlink.substring(0, 20) + '...' : log.permlink}
                          <ExternalLink size={11} color="var(--text-muted)" />
                        </a>
                      </td>
                      <td>@{log.voter}</td>
                      <td>{parseFloat(Number(log.weight || 0).toFixed(2))}%</td>
                      <td>
                        <VoteStatusBadge status={log.status} error={log.error} />
                      </td>
                      <td style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }} title={parseSqlTs(log.timestamp)?.toLocaleString()}>
                        {formatLogTime(log.timestamp)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination Controls */}
            {totalLogs > logsPerPage && (
              <div className="pagination-container">
                <div className="pagination-info">
                  Showing {startIndex + 1} to {Math.min(startIndex + logsPerPage, totalLogs)} of {totalLogs} votes
                </div>
                <div className="pagination-controls">
                  <button
                    type="button"
                    className="page-btn"
                    onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                    disabled={validPage === 1}
                    title="Previous Page"
                  >
                    <ChevronLeft size={14} />
                  </button>

                  {(() => {
                    const pages = [];
                    const sibling = 1; // pages on each side of current
                    const left  = Math.max(2, validPage - sibling);
                    const right = Math.min(totalPages - 1, validPage + sibling);

                    // Always show page 1
                    pages.push(1);

                    // Left ellipsis
                    if (left > 2) pages.push('left-dots');

                    // Range around current page
                    for (let i = left; i <= right; i++) pages.push(i);

                    // Right ellipsis
                    if (right < totalPages - 1) pages.push('right-dots');

                    // Always show last page (if > 1)
                    if (totalPages > 1) pages.push(totalPages);

                    return pages.map((p) =>
                      typeof p === 'string' ? (
                        <span key={p} className="page-ellipsis">…</span>
                      ) : (
                        <button
                          key={p}
                          type="button"
                          className={`page-btn ${p === validPage ? 'active' : ''}`}
                          onClick={() => setCurrentPage(p)}
                        >
                          {p}
                        </button>
                      )
                    );
                  })()}

                  <button
                    type="button"
                    className="page-btn"
                    onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                    disabled={validPage === totalPages}
                    title="Next Page"
                  >
                    <ChevronRight size={14} />
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      </>)} {/* end activePage === 'dashboard' */}

      {/* Add Trail Modal */}
      <AddTrailModal
        isOpen={showAddModal}
        onClose={() => setShowAddModal(false)}
        onAddTrail={handleAddTrail}
      />

      {/* Delete/Unfollow Trail Confirmation Modal */}
      <ConfirmModal
        isOpen={!!trailToDelete}
        title="Unfollow Trail Account"
        message={trailToDelete ? `Are you sure you want to stop following @${trailToDelete.trail_account}? Your account @${user.username} will no longer replicate votes from this trail leader.` : ''}
        confirmText="Unfollow Account"
        confirmStyle="btn-danger"
        isProcessing={modalProcessing}
        onConfirm={handleConfirmDeleteTrail}
        onCancel={() => setTrailToDelete(null)}
      />

      {/* Authority Management Modal (Grant/Revoke via Keychain or Active Key) */}
      <AuthorityModal
        isOpen={showAuthorityModal !== null}
        mode={showAuthorityModal}
        username={user.username}
        botAccount={botAccount}
        isProcessing={modalProcessing}
        onConfirmKeychain={showAuthorityModal === 'grant' ? handleConfirmGrantKeychain : handleConfirmRevokeKeychain}
        onConfirmActiveKey={showAuthorityModal === 'grant' ? handleConfirmGrantActiveKey : handleConfirmRevokeActiveKey}
        onCancel={() => setShowAuthorityModal(null)}
      />

    </div>
  );
}

// ── Root App Component ──────────────────────────────────────────────────────
export default function App() {
  // Check localStorage synchronously to determine if we have a saved session with valid JWT
  const savedSession = localStorage.getItem(SESSION_STORAGE_KEY);
  const savedToken = localStorage.getItem(JWT_STORAGE_KEY);
  const hasValidSession = !!(savedSession && savedToken);

  const [currentUser, setCurrentUser] = useState(null);
  const [steemProfile, setSteemProfile] = useState(null);
  const [trails, setTrails] = useState([]);
  const [status, setStatus] = useState(null);
  const [logs, setLogs] = useState([]);
  // If there's a saved session with token, restore it before rendering dashboard
  const [sessionRestored, setSessionRestored] = useState(!hasValidSession);
  const [initialLoading, setInitialLoading] = useState(true);

  // Stable ref to avoid dependency cycles
  const currentUserRef = React.useRef(null);
  currentUserRef.current = currentUser;

  // Guard flag: prevents in-flight loadData from restoring session after logout
  const loggedOutRef = React.useRef(false);

  // WebSocket ref
  const wsRef = React.useRef(null);
  const reconnectTimerRef = React.useRef(null);
  const [wsState, setWsState] = useState('connecting'); // connecting | connected | disconnected

  // One-time HTTP fetch for initial data load (session restore)
  const loadDataOnce = useCallback(async (targetUsername) => {
    try {
      const [statusRes, logsRes] = await Promise.all([
        api('/status').catch(() => null),
        api(`/logs${targetUsername ? `?user=${targetUsername}` : ''}`).catch(() => null),
      ]);

      if (statusRes?.success) setStatus(statusRes);
      if (logsRes?.success) setLogs(logsRes.logs || []);

      // If user explicitly logged out while this call was in-flight, skip session restore
      if (loggedOutRef.current) return;

      const sessionUser = targetUsername || currentUserRef.current?.username || localStorage.getItem(SESSION_STORAGE_KEY);
      const token = localStorage.getItem(JWT_STORAGE_KEY);
      if (sessionUser && token) {
        const userRes = await api(`/user/${sessionUser}`).catch(() => null);

        // Re-check after async call — user may have logged out while we were fetching
        if (loggedOutRef.current) return;

        if (userRes?.success && userRes.user) {
          setCurrentUser(userRes.user);
          if (userRes.steemProfile) setSteemProfile(userRes.steemProfile);
          if (userRes.trails) setTrails(userRes.trails);
          localStorage.setItem(SESSION_STORAGE_KEY, sessionUser);
        } else {
          // User deleted or not found on server — clear session
          localStorage.removeItem(SESSION_STORAGE_KEY);
          localStorage.removeItem(JWT_STORAGE_KEY);
          setCurrentUser(null);
        }
      } else if (sessionUser && !token) {
        localStorage.removeItem(SESSION_STORAGE_KEY);
        setCurrentUser(null);
      }
    } catch (err) {
      console.error('Data refresh error:', err);
    } finally {
      setInitialLoading(false);
      setSessionRestored(true);
    }
  }, []);

  // WebSocket connection with auto-reconnect
  const connectWs = useCallback(() => {
    if (wsRef.current && wsRef.current.readyState <= 1) return; // already open/connecting

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;
    setWsState('connecting');

    ws.onopen = () => {
      console.log('[WS] Connected');
      setWsState('connected');
      // Subscribe to the current user's updates
      const username = currentUserRef.current?.username || localStorage.getItem(SESSION_STORAGE_KEY);
      if (username) {
        ws.send(JSON.stringify({ type: 'subscribe', username }));
      }
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (loggedOutRef.current) return;

        switch (msg.type) {
          case 'status':
            setStatus(prev => ({ ...prev, success: true, ...msg.data }));
            break;
          case 'logs':
            setLogs(msg.data || []);
            break;
          case 'user': {
            const d = msg.data;
            const activeUser = currentUserRef.current?.username;
            if (activeUser && d.username === activeUser) {
              if (d.user) setCurrentUser(d.user);
              if (d.steemProfile) setSteemProfile(d.steemProfile);
              if (d.trails) setTrails(d.trails);
            }
            break;
          }
        }
      } catch (e) { /* ignore */ }
    };

    ws.onclose = () => {
      console.log('[WS] Disconnected, reconnecting in 3s...');
      setWsState('disconnected');
      reconnectTimerRef.current = setTimeout(connectWs, 3000);
    };

    ws.onerror = () => {
      ws.close();
    };
  }, []);

  // Initial load + WS connection + auth expiration listener
  useEffect(() => {
    // Pass the saved username so the initial logs fetch is user-scoped
    loadDataOnce(localStorage.getItem(SESSION_STORAGE_KEY) || undefined);
    connectWs();

    const onAuthExpired = () => {
      handleLogout();
    };
    window.addEventListener('steem_auth_expired', onAuthExpired);

    return () => {
      window.removeEventListener('steem_auth_expired', onAuthExpired);
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      if (wsRef.current) wsRef.current.close();
    };
  }, [loadDataOnce, connectWs]);

  const handleAuthenticated = (user, profile, userTrails, token) => {
    loggedOutRef.current = false; // Clear the logout guard
    setCurrentUser(user);
    if (profile) setSteemProfile(profile);
    if (userTrails) setTrails(userTrails);
    localStorage.setItem(SESSION_STORAGE_KEY, user.username);
    if (token) localStorage.setItem(JWT_STORAGE_KEY, token);
    setSessionRestored(true);
    // Immediately load this user's vote logs (don't wait for the next WS broadcast)
    setLogs([]);
    api(`/logs?user=${user.username}`)
      .then(res => { if (res?.success && !loggedOutRef.current) setLogs(res.logs || []); })
      .catch(() => {});
    // Subscribe WebSocket to this user's updates
    if (wsRef.current && wsRef.current.readyState === 1) {
      wsRef.current.send(JSON.stringify({ type: 'subscribe', username: user.username }));
    }
  };

  const handleLogout = () => {
    loggedOutRef.current = true; // Set guard BEFORE clearing state
    localStorage.removeItem(SESSION_STORAGE_KEY);
    localStorage.removeItem(JWT_STORAGE_KEY);
    setCurrentUser(null);
    setSteemProfile(null);
    setTrails([]);
    setLogs([]); // Don't leak the previous user's logs to the next login
  };

  const botAccount = status?.botAccount || 'votebd';

  // Show loading state while restoring a saved session OR during initial load
  if (!sessionRestored || (initialLoading && !currentUser)) {
    return (
      <div className="preloader-container">
        <div className="spinner"></div>
        <div className="preloader-text">Loading Dashboard...</div>
      </div>
    );
  }

  return (
    <>
      {!currentUser ? (
        <LoginWall
          botAccount={botAccount}
          onAuthenticated={handleAuthenticated}
        />
      ) : (
        <DashboardView
          user={currentUser}
          steemProfile={steemProfile}
          trails={trails}
          logs={logs}
          status={status}
          wsState={wsState}
          botAccount={botAccount}
          onRefresh={() => loadDataOnce(currentUser?.username)}
          onLogout={handleLogout}
        />
      )}
    </>
  );
}
