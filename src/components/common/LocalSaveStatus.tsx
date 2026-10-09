import { AlertCircle, CheckCircle2, RefreshCw, Save } from 'lucide-react';
import { useCanvasStore } from '../../store/useCanvasStore';

export function LocalSaveStatus() {
  const { saveStatus, saveError, flushAllSaves } = useCanvasStore();
  const label = saveStatus === 'error' ? 'Повторить сохранение' : saveStatus === 'saving' ? 'Сохранение…' : saveStatus === 'unsaved' ? 'Есть правки' : 'Сохранено на устройстве';
  const Icon = saveStatus === 'error' ? AlertCircle : saveStatus === 'saving' ? RefreshCw : saveStatus === 'unsaved' ? Save : CheckCircle2;
  return (
    <button className={`sync-badge-btn ${saveStatus === 'error' ? 'error' : ''}`} title={saveError || label}
      onClick={() => { void flushAllSaves().catch(() => {}); }} aria-label={label}>
      <Icon size={14} className={saveStatus === 'saving' ? 'spinning' : undefined} />
      <span role="status" aria-live="polite">{label}</span>
    </button>
  );
}
