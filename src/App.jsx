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
  ChevronRight
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
  const nodes = ['https://api.steemit.com', 'https://api.justyy.com', 'https://api.steem.fans'];
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
      return <span className="badge badge-success" title={title}>✅ Voted</span>;
    case 'SKIPPED_VP':
      return <span className="badge badge-danger" title={title}>❌ Low VP</span>;
    case 'FAILED':
      return <span className="badge badge-danger" title={title} style={{ cursor: error ? 'help' : 'default' }}>❌ Failed</span>;
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

// ── Dashboard View ──────────────────────────────────────────────────────────
function DashboardView({ user, steemProfile, trails = [], logs = [], status, botAccount, onRefresh, onLogout }) {
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
      {/* Top Header */}
      <div className="flex-header" style={{ marginBottom: '2rem', paddingBottom: '1rem', borderBottom: '1px solid var(--border-subtle)' }}>
        <div>
          <h1 style={{ fontSize: '1.25rem', fontWeight: '700', margin: 0 }}>
            Steem Curation Trial
          </h1>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', margin: 0 }}>
            Block #{status?.syncedBlock?.toLocaleString() ?? '...'} · Bot: @{botAccount}
          </p>
        </div>

        <div className="header-actions" style={{ alignItems: 'center', gap: '0.75rem' }}>
          <span className="badge badge-neutral" style={{ padding: '0.35rem 0.65rem' }}>
            @{user.username}
          </span>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={onLogout}
            title="Sign Out"
          >
            <LogOut size={14} />
            <span className="hide-mobile">Sign Out</span>
          </button>
        </div>
      </div>

      {actionError && (
        <div className="alert-box alert-error" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <AlertCircle size={16} />
          <span>{actionError}</span>
        </div>
      )}

      {actionSuccess && (
        <div className="alert-box alert-info" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--color-success)' }}>
          <Check size={16} />
          <span>{actionSuccess}</span>
        </div>
      )}

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

      {/* Account Status Card */}
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
              onClick={handleToggleGlobalStatus}
            >
              {isAccountActive ? <><Pause size={13} /> Pause All</> : <><Play size={13} /> Resume All</>}
            </button>
            {hasBotAuth && (
              <button
                type="button"
                className="btn btn-danger btn-sm"
                onClick={() => setShowAuthorityModal('revoke')}
              >
                Revoke Authority
              </button>
            )}
          </div>
        </div>

        <div style={{ marginTop: '1.25rem' }}>
          <VotingPowerMeter vp={vp} />
        </div>
      </div>


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
                      <td style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                        {new Date(log.timestamp + 'Z').toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
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

                  {Array.from({ length: totalPages }, (_, i) => i + 1).map((pageNum) => (
                    <button
                      key={pageNum}
                      type="button"
                      className={`page-btn ${pageNum === validPage ? 'active' : ''}`}
                      onClick={() => setCurrentPage(pageNum)}
                    >
                      {pageNum}
                    </button>
                  ))}

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

  // One-time HTTP fetch for initial data load (session restore)
  const loadDataOnce = useCallback(async (targetUsername) => {
    try {
      const [statusRes, logsRes] = await Promise.all([
        api('/status').catch(() => null),
        api('/logs?limit=50').catch(() => null),
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

    ws.onopen = () => {
      console.log('[WS] Connected');
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
      reconnectTimerRef.current = setTimeout(connectWs, 3000);
    };

    ws.onerror = () => {
      ws.close();
    };
  }, []);

  // Initial load + WS connection + auth expiration listener
  useEffect(() => {
    loadDataOnce();
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
          botAccount={botAccount}
          onRefresh={() => loadDataOnce(currentUser?.username)}
          onLogout={handleLogout}
        />
      )}
    </>
  );
}
