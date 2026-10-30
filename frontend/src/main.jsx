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
      return (
        <div className="min-h-screen bg-[#f4f2ed] flex items-center justify-center p-6 font-mono">
          <div className="max-w-md w-full bg-white border-4 border-black shadow-[8px_8px_0px_rgba(0,0,0,1)] p-6 text-center space-y-4">
            <h2 className="text-xl font-black text-[#ff4b3f] uppercase tracking-tight">Application Error Encountered</h2>
            <p className="text-xs font-bold text-slate-700 bg-red-50 border-2 border-black p-3 text-left overflow-auto max-h-36">
              {this.state.error?.message || "An unexpected rendering exception occurred."}
            </p>
            <p className="text-[11px] font-bold text-slate-500">
              Your session and saved data are intact. Click below to reload cleanly.
            </p>
            <button
              onClick={() => { this.setState({ hasError: false }); window.location.reload(); }}
              className="w-full py-3 px-4 bg-[#ffd615] text-black border-2 border-black font-black uppercase tracking-wider shadow-[3px_3px_0px_rgba(0,0,0,1)] hover:bg-yellow-400 active:translate-x-[1px] active:translate-y-[1px]"
            >
              RELOAD APPLICATION
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
