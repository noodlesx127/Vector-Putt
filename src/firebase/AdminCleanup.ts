// Admin interface for Firebase database cleanup
// Provides UI integration for the cleanup tool
import { DatabaseCleanup, CleanupOptions, CleanupReport } from './DatabaseCleanup.js';
import { FirebaseDatabase, FirebaseUser } from './database.js';

export interface AdminCleanupState {
  isRunning: boolean;
  lastReport: CleanupReport | null;
  error: string | null;
}

export class AdminCleanup {
  private state: AdminCleanupState = {
    isRunning: false,
    lastReport: null,
    error: null
  };

  private listeners: ((state: AdminCleanupState) => void)[] = [];

  // Subscribe to state changes
  subscribe(listener: (state: AdminCleanupState) => void): () => void {
    this.listeners.push(listener);
    return () => {
      const index = this.listeners.indexOf(listener);
      if (index > -1) {
        this.listeners.splice(index, 1);
      }
    };
  }

  private notifyListeners(): void {
    this.listeners.forEach(listener => listener({ ...this.state }));
  }

  getState(): AdminCleanupState {
    return { ...this.state };
  }

  async runCleanup(options: CleanupOptions = {}): Promise<CleanupReport> {
    if (this.state.isRunning) {
      throw new Error('Cleanup is already running');
    }

    this.state.isRunning = true;
    this.state.error = null;
    this.notifyListeners();

    try {
      const cleanup = new DatabaseCleanup();
      const report = await cleanup.cleanup(options);
      
      this.state.lastReport = report;
      this.state.isRunning = false;
      this.notifyListeners();
      
      return report;
    } catch (error) {
      this.state.error = error instanceof Error ? error.message : String(error);
      this.state.isRunning = false;
      this.notifyListeners();
      throw error;
    }
  }

  async previewCleanup(): Promise<CleanupReport> {
    return this.runCleanup({ dryRun: true });
  }

  async quickCleanup(): Promise<CleanupReport> {
    return DatabaseCleanup.quickCleanup();
  }

  async removeTestDataOnly(): Promise<CleanupReport> {
    return DatabaseCleanup.removeTestDataOnly();
  }

  // Render cleanup UI for admin panel
  renderCleanupPanel(): string {
    const state = this.getState();
    
    return `
      <div class="admin-cleanup-panel">
        <h3>🧹 Database Cleanup</h3>
        
        <div class="cleanup-status">
          ${state.isRunning ? 
            '<div class="status-running">🔄 Cleanup in progress...</div>' :
            '<div class="status-idle">✅ Ready</div>'
          }
          
          ${state.error ? 
            `<div class="status-error">❌ Error: ${state.error}</div>` : ''
          }
        </div>

        <div class="cleanup-actions">
          <button onclick="adminCleanup.previewCleanup()" ${state.isRunning ? 'disabled' : ''}>
            🔍 Preview Cleanup
          </button>
          
          <button onclick="adminCleanup.quickCleanup()" ${state.isRunning ? 'disabled' : ''}>
            🧹 Quick Cleanup
          </button>
          
          <button onclick="adminCleanup.removeTestDataOnly()" ${state.isRunning ? 'disabled' : ''}>
            🧪 Remove Test Data
          </button>
        </div>

        ${state.lastReport ? this.renderLastReport(state.lastReport) : ''}
      </div>
    `;
  }

  private renderLastReport(report: CleanupReport): string {
    return `
      <div class="cleanup-report">
        <h4>📊 Last Cleanup Report</h4>
        <div class="report-timestamp">
          ${new Date(report.timestamp).toLocaleString()}
        </div>
        
        <div class="report-stats">
          <div class="stat">
            <span class="stat-label">Users Scanned:</span>
            <span class="stat-value">${report.totalUsersScanned}</span>
          </div>
          <div class="stat">
            <span class="stat-label">Levels Scanned:</span>
            <span class="stat-value">${report.totalLevelsScanned}</span>
          </div>
          <div class="stat">
            <span class="stat-label">Duplicates Removed:</span>
            <span class="stat-value">${report.duplicateUsersRemoved + report.duplicateLevelsRemoved}</span>
          </div>
          <div class="stat">
            <span class="stat-label">Orphans Removed:</span>
            <span class="stat-value">${report.orphanedLevelsRemoved}</span>
          </div>
          <div class="stat">
            <span class="stat-label">Data Fixed:</span>
            <span class="stat-value">${report.invalidDataFixed}</span>
          </div>
        </div>

        ${report.warnings.length > 0 ? `
          <div class="report-warnings">
            <h5>⚠️ Warnings:</h5>
            <ul>
              ${report.warnings.map(w => `<li>${w}</li>`).join('')}
            </ul>
          </div>
        ` : ''}

        ${report.errors.length > 0 ? `
          <div class="report-errors">
            <h5>❌ Errors:</h5>
            <ul>
              ${report.errors.map(e => `<li>${e}</li>`).join('')}
            </ul>
          </div>
        ` : ''}
      </div>
    `;
  }

  // CSS styles for the cleanup panel
  getStyles(): string {
    return `
      <style>
        .admin-cleanup-panel {
          background: #f5f5f5;
          border: 1px solid #ddd;
          border-radius: 8px;
          padding: 20px;
          margin: 20px 0;
          font-family: Arial, sans-serif;
        }

        .admin-cleanup-panel h3 {
          margin-top: 0;
          color: #333;
        }

        .cleanup-status {
          margin: 15px 0;
        }

        .status-running {
          color: #007bff;
          font-weight: bold;
        }

        .status-idle {
          color: #28a745;
          font-weight: bold;
        }

        .status-error {
          color: #dc3545;
          font-weight: bold;
          background: #f8d7da;
          padding: 10px;
          border-radius: 4px;
          border: 1px solid #f5c6cb;
        }

        .cleanup-actions {
          display: flex;
          gap: 10px;
          margin: 20px 0;
          flex-wrap: wrap;
        }

        .cleanup-actions button {
          background: #007bff;
          color: white;
          border: none;
          padding: 10px 15px;
          border-radius: 4px;
          cursor: pointer;
          font-size: 14px;
        }

        .cleanup-actions button:hover:not(:disabled) {
          background: #0056b3;
        }

        .cleanup-actions button:disabled {
          background: #6c757d;
          cursor: not-allowed;
        }

        .cleanup-report {
          background: white;
          border: 1px solid #ddd;
          border-radius: 4px;
          padding: 15px;
          margin-top: 20px;
        }

        .cleanup-report h4 {
          margin-top: 0;
          color: #333;
        }

        .report-timestamp {
          color: #666;
          font-size: 12px;
          margin-bottom: 15px;
        }

        .report-stats {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
          gap: 10px;
          margin-bottom: 15px;
        }

        .stat {
          display: flex;
          justify-content: space-between;
          padding: 8px;
          background: #f8f9fa;
          border-radius: 4px;
        }

        .stat-label {
          font-weight: bold;
        }

        .stat-value {
          color: #007bff;
          font-weight: bold;
        }

        .report-warnings, .report-errors {
          margin-top: 15px;
        }

        .report-warnings h5 {
          color: #856404;
          margin-bottom: 10px;
        }

        .report-errors h5 {
          color: #721c24;
          margin-bottom: 10px;
        }

        .report-warnings ul, .report-errors ul {
          margin: 0;
          padding-left: 20px;
        }

        .report-warnings li {
          color: #856404;
        }

        .report-errors li {
          color: #721c24;
        }
      </style>
    `;
  }
}

// Global instance for admin panel
export const adminCleanup = new AdminCleanup();

// Make available globally for HTML onclick handlers
if (typeof window !== 'undefined') {
  (window as any).adminCleanup = adminCleanup;
}

export default AdminCleanup;
