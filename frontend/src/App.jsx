import { useEffect, useState } from 'react';

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:8080';

const SENTIMENT_COLORS = {
  Bullish: '#16a34a',
  Neutral: '#6b7280',
  Bearish: '#dc2626',
};
const RISK_COLORS = {
  Low: '#16a34a',
  Medium: '#d97706',
  High: '#dc2626',
};

export default function App() {
  const [symbol, setSymbol] = useState('AAPL');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const [history, setHistory] = useState([]);

  async function loadHistory() {
    try {
      const r = await fetch(`${API_BASE}/api/history?limit=10`);
      if (!r.ok) return;
      const data = await r.json();
      setHistory(data.items || []);
    } catch (e) {
      // 历史失败不影响主流程
    }
  }

  useEffect(() => {
    loadHistory();
  }, []);

  async function analyze(e) {
    e?.preventDefault();
    if (!symbol.trim()) return;
    setLoading(true);
    setError('');
    setResult(null);
    try {
      const r = await fetch(`${API_BASE}/api/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol: symbol.trim().toUpperCase() }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || `请求失败 ${r.status}`);
      setResult(data);
      loadHistory();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="page">
      <header className="hero">
        <h1>📈 AI 股票分析面板</h1>
        <p className="subtitle">
          输入股票代码 → 调用 LLM 分析 → 严格 JSON 输出（summary / sentiment / risk_level）
        </p>
      </header>

      <form className="search" onSubmit={analyze}>
        <input
          value={symbol}
          onChange={(e) => setSymbol(e.target.value.toUpperCase())}
          placeholder="例如 AAPL、TSLA、NVDA"
          maxLength={10}
        />
        <button type="submit" disabled={loading}>
          {loading ? '分析中…' : '分析'}
        </button>
      </form>

      {error && <div className="error">⚠️ {error}</div>}

      {result && (
        <section className="card">
          <div className="card-head">
            <h2>{result.symbol}</h2>
            <span className="time">{new Date(result.created_at).toLocaleString()}</span>
          </div>

          <div className="quote-grid">
            <Stat label="现价" value={result.quote.current} />
            <Stat label="开盘" value={result.quote.open} />
            <Stat label="最高" value={result.quote.high} />
            <Stat label="最低" value={result.quote.low} />
            <Stat label="昨收" value={result.quote.prevClose} />
            <Stat
              label="涨跌幅"
              value={`${result.quote.changePct?.toFixed(2)}%`}
              color={result.quote.changePct >= 0 ? '#16a34a' : '#dc2626'}
            />
          </div>

          <div className="badges">
            <Badge
              label="情绪"
              value={result.analysis.sentiment}
              color={SENTIMENT_COLORS[result.analysis.sentiment]}
            />
            <Badge
              label="风险"
              value={result.analysis.risk_level}
              color={RISK_COLORS[result.analysis.risk_level]}
            />
          </div>

          <p className="summary">{result.analysis.summary}</p>
        </section>
      )}

      <section className="history">
        <h3>最近分析</h3>
        {history.length === 0 ? (
          <p className="muted">暂无记录（或 Supabase 未配置）</p>
        ) : (
          <ul>
            {history.map((h) => (
              <li key={h.id}>
                <strong>{h.symbol}</strong>
                <span
                  className="pill"
                  style={{ background: SENTIMENT_COLORS[h.sentiment] }}
                >
                  {h.sentiment}
                </span>
                <span
                  className="pill"
                  style={{ background: RISK_COLORS[h.risk_level] }}
                >
                  {h.risk_level}
                </span>
                <span className="hsum">{h.summary}</span>
                <span className="time">
                  {new Date(h.created_at).toLocaleString()}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <footer className="foot">
        Backend: <code>{API_BASE}</code>
      </footer>
    </div>
  );
}

function Stat({ label, value, color }) {
  return (
    <div className="stat">
      <div className="stat-label">{label}</div>
      <div className="stat-value" style={{ color }}>
        {value ?? '-'}
      </div>
    </div>
  );
}

function Badge({ label, value, color }) {
  return (
    <div className="badge" style={{ background: color }}>
      <span className="badge-label">{label}</span>
      <span className="badge-value">{value}</span>
    </div>
  );
}
