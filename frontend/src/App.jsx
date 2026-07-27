import React, { useState, useEffect } from 'react';

const API_BASE = 'http://localhost:8000/api';

const DEFAULT_SAMPLE_STOCK = `item_name,current_quantity,reorder_threshold,target_stock
Heavy Duty Pallet Straps,12,50,150
Industrial Steel Shelving,4,20,50
Barcode Scanner Model X,0,15,40
Bubble Wrap Rolls (100m),85,40,100
Forklift Battery Pack,1,5,10
Standard Wooden Pallet,120,50,120
Safety Hard Hats,8,30,80
Shipping Label Printer,3,10,25
Packing Tape Rolls,220,100,300
Cardboard Boxes (Large),15,100,300`;

const DEFAULT_EDGE_STOCK = `Product,Qty,Threshold,Target
Hydraulic Lift Cart,5,15,30
Corrugated Storage Bins,OUT_OF_STOCK,50,150
Thermal Printer Paper,,20,60
Digital Weight Scale,0,5,12
High-Visibility Vests,18,20,50
Stretcher Wrap (Clear),-2,30,80
Hand Pallet Truck,3,3,10
Invalid Row Item`;

export default function App() {
  const [activeTab, setActiveTab] = useState('scanner');
  const [backendOnline, setBackendOnline] = useState(false);
  const [loading, setLoading] = useState(false);
  
  // Data state
  const [rawCsvText, setRawCsvText] = useState(DEFAULT_SAMPLE_STOCK);
  const [scanData, setScanData] = useState(null);
  const [emailAlert, setEmailAlert] = useState(null);
  const [consoleReport, setConsoleReport] = useState('');
  const [warnings, setWarnings] = useState([]);
  const [reflectionNote, setReflectionNote] = useState('');
  
  // Filters & Search
  const [searchQuery, setSearchQuery] = useState('');
  const [filterPriority, setFilterPriority] = useState('ALL');
  const [copySuccess, setCopySuccess] = useState(false);

  // Check Backend Connectivity on Mount
  useEffect(() => {
    checkBackendHealth();
    // Run initial scan
    handleScan(DEFAULT_SAMPLE_STOCK);
  }, []);

  const checkBackendHealth = async () => {
    try {
      const res = await fetch(`${API_BASE}/health/`);
      if (res.ok) {
        setBackendOnline(true);
      }
    } catch {
      setBackendOnline(false);
    }
  };

  // Scan CSV logic (communicates with Django API or falls back cleanly)
  const handleScan = async (csvContent, filename = 'stock.csv') => {
    setLoading(true);
    try {
      let res;
      if (backendOnline) {
        res = await fetch(`${API_BASE}/scan/`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ csv_text: csvContent, filename })
        });
      }

      if (res && res.ok) {
        const data = await res.json();
        setScanData(data.scan_results);
        setEmailAlert(data.email_alert);
        setConsoleReport(data.console_report);
        setWarnings(data.scan_results.warnings || []);
        setReflectionNote(data.reflection_note);
      } else {
        // Fallback local scanning if API unavailable
        performLocalScan(csvContent);
      }
    } catch (err) {
      console.warn('Backend API request failed, using client-side scanning engine', err);
      performLocalScan(csvContent);
    } finally {
      setLoading(false);
    }
  };

  // Client-side parser fallback to ensure UI always works smoothly
  const performLocalScan = (content) => {
    const lines = content.split('\n').map(l => l.trim()).filter(Boolean);
    if (lines.length < 2) return;

    const items = [];
    const restockItems = [];
    const warnList = [];
    const counts = { total: 0, critical: 0, low: 0, sufficient: 0 };

    for (let i = 1; i < lines.length; i++) {
      const parts = lines[i].split(',');
      if (parts.length < 2) continue;

      counts.total++;
      const name = parts[0]?.trim() || `Item ${i}`;
      let rawQty = parts[1]?.trim();
      let rawThresh = parts[2]?.trim();
      let rawTarget = parts[3]?.trim();

      let qty = parseFloat(rawQty);
      if (isNaN(qty)) {
        if (['OUT_OF_STOCK', 'N/A', 'NONE'].includes(rawQty?.toUpperCase())) {
          qty = 0;
          warnList.push(`Row ${i+1} [${name}]: String '${rawQty}' parsed as 0 stock.`);
        } else {
          qty = 0;
          warnList.push(`Row ${i+1} [${name}]: Invalid quantity value parsed as 0.`);
        }
      }
      if (qty < 0) {
        qty = 0;
        warnList.push(`Row ${i+1} [${name}]: Negative quantity normalized to 0.`);
      }

      let thresh = parseFloat(rawThresh) || 10;
      let target = parseFloat(rawTarget) || (thresh * 2);

      const reorderNeeded = qty < thresh;
      let priority = 'Sufficient';
      let status = 'SUFFICIENT';

      if (qty === 0 || qty <= (thresh * 0.25)) {
        priority = 'Critical';
        status = 'CRITICAL';
        counts.critical++;
      } else if (reorderNeeded) {
        priority = 'Low';
        status = 'LOW';
        counts.low++;
      } else {
        counts.sufficient++;
      }

      const suggestedReorder = reorderNeeded ? Math.max(0, target - qty) : 0;

      const item = {
        id: i,
        item_name: name,
        current_quantity: qty,
        reorder_threshold: thresh,
        target_stock: target,
        reorder_needed: reorderNeeded,
        priority,
        status,
        suggested_reorder: Math.round(suggestedReorder)
      };

      items.push(item);
      if (reorderNeeded) restockItems.push(item);
    }

    const localResults = {
      timestamp: new Date().toISOString().replace('T', ' ').substring(0, 19),
      total_items: counts.total,
      restock_needed_count: restockItems.length,
      summary_counts: counts,
      items,
      restock_items: restockItems,
      warnings: warnList
    };

    setScanData(localResults);
    setWarnings(warnList);
    
    // Email alert generation
    const emailSubj = `🚨 [WAREHOUSE ALERT] ${restockItems.length} Item(s) Require Restocking (${counts.critical} Critical)`;
    let emailMsg = `Hello Warehouse Operations Team,\n\nAutomated morning restock alert:\n- Critical Action Items: ${counts.critical}\n- Low Stock Items: ${counts.low}\n- Sufficient Items: ${counts.sufficient}\n\nREPLENISHMENT TABLE:\n`;
    restockItems.forEach(item => {
      emailMsg += `${item.priority.toUpperCase().padEnd(10)} | ${item.item_name.padEnd(28)} | Qty: ${item.current_quantity} | Threshold: ${item.reorder_threshold} | Reorder: ${item.suggested_reorder}\n`;
    });
    emailMsg += `\nPlease verify inventory physically and initiate supplier orders.\n\nBest regards,\nWarehouse Automation Bot 🤖`;

    setEmailAlert({ subject: emailSubj, body: emailMsg });
    setReflectionNote(`1. Automated Scheduling: Integrate Celery/Cron daily at 06:00 AM.\n2. Supplier Integration: Automatic EDI/REST purchase orders for Critical items.\n3. Dynamic Thresholds: Consumption velocity + lead time safety stock.\n4. Multi-Warehouse Support: Track Bin/Aisle IDs across facilities.`);
  };

  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      const content = evt.target.result;
      setRawCsvText(content);
      handleScan(content, file.name);
    };
    reader.readAsText(file);
  };

  const handlePresetClick = (presetType) => {
    const text = presetType === 'edge' ? DEFAULT_EDGE_STOCK : DEFAULT_SAMPLE_STOCK;
    setRawCsvText(text);
    handleScan(text, presetType === 'edge' ? 'sample_edge_case_stock.csv' : 'sample_stock.csv');
  };

  const handleExportCSV = async () => {
    if (!scanData || !scanData.restock_items) return;
    try {
      const res = await fetch(`${API_BASE}/export-restock-csv/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ restock_items: scanData.restock_items })
      });
      if (res.ok) {
        const blob = await res.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'restock_report.csv';
        a.click();
        return;
      }
    } catch {
      // Fallback local CSV download
    }

    // Local CSV generation fallback
    const headers = ['Item Name', 'Current Quantity', 'Reorder Threshold', 'Target Stock', 'Priority Level', 'Suggested Reorder Qty'];
    const rows = scanData.restock_items.map(item => [
      `"${item.item_name}"`,
      item.current_quantity,
      item.reorder_threshold,
      item.target_stock,
      item.priority,
      item.suggested_reorder
    ]);
    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', 'restock_report.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleCopyEmail = () => {
    if (!emailAlert) return;
    const fullText = `SUBJECT: ${emailAlert.subject}\n\n${emailAlert.body}`;
    navigator.clipboard.writeText(fullText);
    setCopySuccess(true);
    setTimeout(() => setCopySuccess(false), 2500);
  };

  // Filter Items
  const filteredItems = (scanData?.items || []).filter(item => {
    const matchesSearch = item.item_name.toLowerCase().includes(searchQuery.toLowerCase());
    if (filterPriority === 'ALL') return matchesSearch;
    if (filterPriority === 'RESTOCK') return matchesSearch && item.reorder_needed;
    if (filterPriority === 'CRITICAL') return matchesSearch && item.priority === 'Critical';
    if (filterPriority === 'LOW') return matchesSearch && item.priority === 'Low';
    if (filterPriority === 'SUFFICIENT') return matchesSearch && item.priority === 'Sufficient';
    return matchesSearch;
  });

  return (
    <div className="app-container">
      {/* Top Navbar */}
      <header className="navbar">
        <div className="brand">
          <div className="brand-icon">📦</div>
          <div>
            <h1 className="brand-title">Apex Warehouse Automation</h1>
            <p className="brand-subtitle">Stock Scanner & Restock Reporting Engine</p>
          </div>
        </div>
        <div className="system-status-pill">
          <span className="status-dot" style={{ backgroundColor: backendOnline ? '#10b981' : '#f59e0b' }}></span>
          <span>{backendOnline ? 'Django REST API Connected' : 'Client Scanner Engine Active'}</span>
        </div>
      </header>

      {/* Summary Stat Cards */}
      <section className="stats-grid">
        <div className="stat-card total">
          <div className="stat-header">
            <span className="stat-title">Total Scanned</span>
            <span>🔍</span>
          </div>
          <div className="stat-value">{scanData?.total_items || 0}</div>
          <div className="stat-meta">Items evaluated from CSV</div>
        </div>

        <div className="stat-card critical">
          <div className="stat-header">
            <span className="stat-title">Critical Low Stock</span>
            <span>🚨</span>
          </div>
          <div className="stat-value">{scanData?.summary_counts?.critical || 0}</div>
          <div className="stat-meta">Stock ≤ 25% threshold or 0</div>
        </div>

        <div className="stat-card low">
          <div className="stat-header">
            <span className="stat-title">Low Stock Warnings</span>
            <span>⚠️</span>
          </div>
          <div className="stat-value">{scanData?.summary_counts?.low || 0}</div>
          <div className="stat-meta">Stock &lt; reorder threshold</div>
        </div>

        <div className="stat-card sufficient">
          <div className="stat-header">
            <span className="stat-title">Healthy Stock</span>
            <span>✅</span>
          </div>
          <div className="stat-value">{scanData?.summary_counts?.sufficient || 0}</div>
          <div className="stat-meta">Adequate inventory level</div>
        </div>
      </section>

      {/* Navigation Tabs */}
      <nav className="tabs-header">
        <button
          className={`tab-btn ${activeTab === 'scanner' ? 'active' : ''}`}
          onClick={() => setActiveTab('scanner')}
        >
          📊 Dashboard & Stock Scanner
        </button>

        <button
          className={`tab-btn ${activeTab === 'restock' ? 'active' : ''}`}
          onClick={() => setActiveTab('restock')}
        >
          📋 Restock Needed Report ({scanData?.restock_needed_count || 0})
        </button>

        <button
          className={`tab-btn ${activeTab === 'email' ? 'active' : ''}`}
          onClick={() => setActiveTab('email')}
        >
          📧 Simulated Email Alert
        </button>

        <button
          className={`tab-btn ${activeTab === 'reflection' ? 'active' : ''}`}
          onClick={() => setActiveTab('reflection')}
        >
          💡 Reflection & Architecture Note
        </button>
      </nav>

      {/* MAIN TAB 1: SCANNER & INVENTORY DASHBOARD */}
      {activeTab === 'scanner' && (
        <main>
          {/* CSV Scanner & Upload Zone */}
          <div className="scanner-grid">
            <div className="card">
              <h2 className="card-title">📁 Scan Stock CSV File</h2>
              <p className="card-subtitle">Upload any warehouse CSV file or select a dataset below.</p>
              
              <label className="dropzone">
                <input type="file" accept=".csv" onChange={handleFileUpload} style={{ display: 'none' }} />
                <div className="dropzone-icon">📤</div>
                <div className="dropzone-text">Click or drag & drop CSV file here</div>
                <div className="dropzone-sub">Supports item name, quantity, threshold, & target stock columns</div>
              </label>

              {loading && <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '12px' }}><div className="spinner"></div><span>Scanning inventory file...</span></div>}
            </div>

            <div className="card">
              <h2 className="card-title">⚙️ Presets & Test Datasets</h2>
              <p className="card-subtitle">Test scanner against standard & edge-case data instant presets.</p>
              
              <div className="preset-group">
                <button className="btn btn-primary" onClick={() => handlePresetClick('standard')}>
                  Load Standard Stock CSV Dataset
                </button>
                <button className="btn btn-outline-danger" onClick={() => handlePresetClick('edge')}>
                  Load Edge-Case Test Dataset (Malformed Rows, Strings, Negatives)
                </button>
                <button className="btn" onClick={handleExportCSV}>
                  📥 Download restock_report.csv
                </button>
              </div>
            </div>
          </div>

          {/* Diagnostic Warnings Alert if any */}
          {warnings.length > 0 && (
            <div className="warnings-box">
              <div className="warnings-title">
                <span>⚠️</span> Edge-Case Diagnostics & Parsing Warnings ({warnings.length})
              </div>
              <ul className="warnings-list">
                {warnings.map((w, idx) => (
                  <li key={idx}>• {w}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Live Inventory Table */}
          <div className="card">
            <div className="table-toolbar">
              <input
                type="text"
                className="search-input"
                placeholder="Search stock item name..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />

              <div className="filter-btn-group">
                <button className={`filter-btn ${filterPriority === 'ALL' ? 'active' : ''}`} onClick={() => setFilterPriority('ALL')}>All Items ({scanData?.total_items || 0})</button>
                <button className={`filter-btn ${filterPriority === 'RESTOCK' ? 'active' : ''}`} onClick={() => setFilterPriority('RESTOCK')}>Needs Restock ({scanData?.restock_needed_count || 0})</button>
                <button className={`filter-btn ${filterPriority === 'CRITICAL' ? 'active' : ''}`} onClick={() => setFilterPriority('CRITICAL')}>Critical ({scanData?.summary_counts?.critical || 0})</button>
                <button className={`filter-btn ${filterPriority === 'LOW' ? 'active' : ''}`} onClick={() => setFilterPriority('LOW')}>Low ({scanData?.summary_counts?.low || 0})</button>
                <button className={`filter-btn ${filterPriority === 'SUFFICIENT' ? 'active' : ''}`} onClick={() => setFilterPriority('SUFFICIENT')}>Sufficient ({scanData?.summary_counts?.sufficient || 0})</button>
              </div>
            </div>

            <div className="table-container">
              <table className="stock-table">
                <thead>
                  <tr>
                    <th>Priority</th>
                    <th>Item Name</th>
                    <th>Current Qty</th>
                    <th>Threshold</th>
                    <th>Target Stock</th>
                    <th>Suggested Reorder</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredItems.length === 0 ? (
                    <tr>
                      <td colSpan="7" style={{ textAlign: 'center', padding: '30px', color: 'var(--text-muted)' }}>
                        No stock items found matching current search/filter criteria.
                      </td>
                    </tr>
                  ) : (
                    filteredItems.map((item) => (
                      <tr key={item.id}>
                        <td>
                          {item.priority === 'Critical' && <span className="badge badge-critical">🚨 CRITICAL</span>}
                          {item.priority === 'Low' && <span className="badge badge-low">⚠️ LOW</span>}
                          {item.priority === 'Sufficient' && <span className="badge badge-sufficient">✅ OK</span>}
                        </td>
                        <td className="item-name">{item.item_name}</td>
                        <td style={{ fontWeight: '700', color: item.reorder_needed ? '#f87171' : '#34d399' }}>
                          {item.current_quantity}
                        </td>
                        <td>{item.reorder_threshold}</td>
                        <td>{item.target_stock}</td>
                        <td style={{ fontWeight: '700', color: item.suggested_reorder > 0 ? '#fbbf24' : 'var(--text-muted)' }}>
                          {item.suggested_reorder > 0 ? `+${item.suggested_reorder} units` : '—'}
                        </td>
                        <td>
                          {item.reorder_needed ? (
                            <span style={{ fontSize: '12px', color: '#f87171', fontWeight: '600' }}>Restock Needed</span>
                          ) : (
                            <span style={{ fontSize: '12px', color: '#34d399' }}>Stock Healthy</span>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </main>
      )}

      {/* MAIN TAB 2: RESTOCK NEEDED REPORT */}
      {activeTab === 'restock' && (
        <main>
          <div className="card" style={{ marginBottom: '24px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px' }}>
              <div>
                <h2 className="card-title">🧾 Warehouse Restock Needed Report</h2>
                <p className="card-subtitle">Official replenishment list generated for morning warehouse shift.</p>
              </div>
              <button className="btn btn-primary" onClick={handleExportCSV}>
                📥 Export restock_report.csv
              </button>
            </div>

            <div className="table-container" style={{ marginTop: '16px' }}>
              <table className="stock-table">
                <thead>
                  <tr>
                    <th>Priority Level</th>
                    <th>Item Name</th>
                    <th>Current Quantity</th>
                    <th>Reorder Threshold</th>
                    <th>Target Stock Level</th>
                    <th>Required Reorder Quantity</th>
                  </tr>
                </thead>
                <tbody>
                  {(!scanData?.restock_items || scanData.restock_items.length === 0) ? (
                    <tr>
                      <td colSpan="6" style={{ textAlign: 'center', padding: '40px', color: '#10b981', fontWeight: '600' }}>
                        🎉 Great news! All items currently meet or exceed reorder thresholds. No replenishment needed.
                      </td>
                    </tr>
                  ) : (
                    scanData.restock_items.map((item) => (
                      <tr key={item.id}>
                        <td>
                          {item.priority === 'Critical' ? (
                            <span className="badge badge-critical">🚨 CRITICAL</span>
                          ) : (
                            <span className="badge badge-low">⚠️ LOW</span>
                          )}
                        </td>
                        <td className="item-name">{item.item_name}</td>
                        <td style={{ color: '#ef4444', fontWeight: '700' }}>{item.current_quantity}</td>
                        <td>{item.reorder_threshold}</td>
                        <td>{item.target_stock}</td>
                        <td style={{ color: '#fbbf24', fontWeight: '800', fontSize: '15px' }}>
                          +{item.suggested_reorder} units
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Raw Text Console Output View */}
          <div className="card">
            <h3 className="card-title" style={{ fontSize: '15px', marginBottom: '12px' }}>🖥️ Raw Terminal Console Report Output</h3>
            <pre className="email-body" style={{ maxHeight: '320px', overflowY: 'auto' }}>
              {consoleReport || 'No console report generated yet.'}
            </pre>
          </div>
        </main>
      )}

      {/* MAIN TAB 3: SIMULATED EMAIL ALERT */}
      {activeTab === 'email' && (
        <main>
          <div className="card" style={{ marginBottom: '20px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px' }}>
              <div>
                <h2 className="card-title">✉️ Simulated Restock Email Alert</h2>
                <p className="card-subtitle">Automated email notification formatted for warehouse managers and supply chain teams.</p>
              </div>
              <button className="btn btn-primary" onClick={handleCopyEmail}>
                {copySuccess ? '✅ Copied to Clipboard!' : '📋 Copy Email Content'}
              </button>
            </div>
          </div>

          {emailAlert ? (
            <div className="email-client-container">
              <div className="email-header">
                <div className="email-row">
                  <span className="email-label">From:</span>
                  <span style={{ color: '#e2e8f0' }}>quiet-automation-bot@warehouse-backend.internal</span>
                </div>
                <div className="email-row">
                  <span className="email-label">To:</span>
                  <span style={{ color: '#e2e8f0' }}>warehouse-ops@supplychain.com, purchasing@company.org</span>
                </div>
                <div className="email-row">
                  <span className="email-label">Subject:</span>
                  <span className="email-subject">{emailAlert.subject}</span>
                </div>
              </div>
              <div className="email-body">
                {emailAlert.body}
              </div>
            </div>
          ) : (
            <div className="card" style={{ textAlign: 'center', padding: '40px' }}>
              <p>No email alert generated yet. Please run a stock scan first.</p>
            </div>
          )}
        </main>
      )}

      {/* MAIN TAB 4: REFLECTION & ARCHITECTURE NOTE */}
      {activeTab === 'reflection' && (
        <main>
          <div className="reflection-card">
            <h2 className="card-title" style={{ fontSize: '22px', marginBottom: '8px' }}>
              🧠 Warehouse Automation Architectural Reflection
            </h2>
            <p className="card-subtitle" style={{ marginBottom: '20px' }}>
              What we would improve with additional development time to scale this quiet backend job into an enterprise supply chain system:
            </p>

            <div className="reflection-content">
              <p style={{ fontWeight: '700', color: '#6366f1', marginBottom: '10px' }}>
                [FUTURE PRODUCTION SYSTEM ENHANCEMENTS]
              </p>
              
              <div style={{ marginBottom: '14px' }}>
                <strong>1. Automated Scheduling (Celery + Redis / Cron):</strong>
                <p style={{ color: '#cbd5e1', marginTop: '4px' }}>
                  Instead of manual triggers, run the scanning engine automatically every morning at 06:00 AM via Celery periodic tasks or Kubernetes CronJobs before warehouse fulfillment shifts start.
                </p>
              </div>

              <div style={{ marginBottom: '14px' }}>
                <strong>2. Supplier EDI & API Integration:</strong>
                <p style={{ color: '#cbd5e1', marginTop: '4px' }}>
                  Automatically transform restock suggestions into draft Purchase Orders (POs) and dispatch via supplier REST APIs or EDI 850 formats for items flagged with 'Critical' priority.
                </p>
              </div>

              <div style={{ marginBottom: '14px' }}>
                <strong>3. Dynamic Reorder Thresholds & Trend Tracking:</strong>
                <p style={{ color: '#cbd5e1', marginTop: '4px' }}>
                  Replace static reorder thresholds with ML-based dynamic safety stock calculated from 30-day moving average consumption rates, supplier lead times, and seasonal demand spikes.
                </p>
              </div>

              <div>
                <strong>4. Multi-Warehouse Location & Bin Tracking:</strong>
                <p style={{ color: '#cbd5e1', marginTop: '4px' }}>
                  Extend data models to track stock by regional distribution centers, aisle/rack/bin coordinates, and lot expiration dates to prevent inventory shrinkage.
                </p>
              </div>
            </div>
          </div>
        </main>
      )}
    </div>
  );
}
