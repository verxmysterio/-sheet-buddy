import { StrictMode, Component } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }
  componentDidCatch(error, errorInfo) {
    console.error("ErrorBoundary caught error:", error, errorInfo);
  }
  render() {
    if (this.state.hasError) {
      let errStr = "An unexpected rendering exception occurred.";
      try {
        if (typeof this.state.error === 'string') {
          errStr = this.state.error;
        } else if (this.state.error && typeof this.state.error.message === 'string') {
          errStr = this.state.error.message;
        } else if (this.state.error && typeof this.state.error === 'object') {
          errStr = JSON.stringify(this.state.error);
        }
      } catch (e) {
        errStr = "Unknown error";
      }

      return (
        <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6 font-sans">
          <div className="max-w-md w-full bg-white rounded-2xl border border-slate-200/80 shadow-xl shadow-slate-200/50 p-7 text-center space-y-4">
            <div className="w-12 h-12 rounded-xl bg-rose-50 border border-rose-100 flex items-center justify-center mx-auto text-rose-600 text-xl font-bold">
              !
            </div>
            <h2 className="text-lg font-bold text-slate-900 tracking-tight">Application Exception Encountered</h2>
            <div className="text-xs font-mono text-slate-700 bg-slate-50 rounded-lg border border-slate-200 p-3.5 text-left overflow-auto max-h-36">
              {String(errStr)}
            </div>
            <p className="text-xs text-slate-500">
              Your session and saved data are intact. Click below to safely reload the interface.
            </p>
            <button
              onClick={() => { this.setState({ hasError: false, error: null }); window.location.reload(); }}
              className="w-full py-2.5 px-4 bg-slate-900 hover:bg-slate-800 text-white rounded-xl font-semibold text-xs tracking-wide shadow-sm transition-all"
            >
              Reload Application
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
